/**
 * cli/src/session.ts
 *
 * Glue between a single PTY process and the WebSocket clients attached to it.
 *
 * Phase 2 behaviour: when an {@link AuthManager} is provided, each inbound
 * connection goes through a handshake before it is attached to the PTY:
 *
 *   1. Client sends `{ type: 'hello', protocolVersion }`.
 *   2. CLI checks version compatibility → sends `{ type: 'hello-ack' }` or
 *      closes with an error.
 *   3. CLI sends `{ type: 'auth-challenge', nonce }`.
 *   4. Client sends `{ type: 'auth-response', deviceId, signature }`.
 *   5. CLI verifies the Device Key signature → attaches the client to the PTY
 *      (output streaming + input forwarding) or closes with an error.
 *
 * When no AuthManager is provided (e.g. dev smoke testing), the handshake is
 * skipped and the client is attached immediately (Phase 1 behaviour).
 *
 * Terminal process behavior is provided by a SessionBackend. A new WebSocket
 * client reattaches to the same backend after completing the handshake.
 */

import type { RawData, WebSocket } from 'ws';
import {
  decodeFrame,
  encodeFrame,
  GIT_RPC_METHODS,
  MAX_SESSION_SCROLLBACK_CHARS,
  MAX_SESSION_SCROLLBACK_CHUNK_CHARS,
  PROTOCOL_VERSION,
  WS_CLOSE_CODES,
  type AlertFrame,
  type Frame,
  type OutputFrame,
  type ResizeFrame,
} from '@mobily/shared';
import type { ExitEvent, IDisposable, SpawnOptions } from './pty/node-pty.js';
import type { AuthManager } from './auth.js';
import type { RpcRouter } from './rpc/router.js';
import { BareBackend } from './mux/bare.js';
import type { SessionBackend } from './mux/types.js';
import type { SessionRuntime } from './mux/runtime.js';
import { TerminalAlertDetector, type AlertDetector } from './alerts/detector.js';
import { CanonicalTerminalScreen } from './terminal/screen.js';

/** `ws.WebSocket` readyState value for an open connection. */
const READY_STATE_OPEN = 1;
const MAX_BUFFERED_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_MAX_ACTIVE_RPC_REQUESTS = 4;

/** Extended spawn options — includes optional auth for the handshake. */
export interface SessionOptions extends SpawnOptions {
  /** Terminal backend. Defaults to the bare PTY adapter. */
  backend?: SessionBackend;
  /** Auth manager for Device Key challenge-response. If omitted, no auth. */
  auth?: AuthManager;
  /** Maximum time allowed for hello + Device Key authentication. @default 10000 */
  handshakeTimeoutMs?: number;
  /** Structured request router available after authentication. */
  rpc?: Pick<RpcRouter, 'handle'>;
  /** Maximum concurrent structured requests per authenticated connection. @default 4 */
  maxActiveRpcRequests?: number;
  /** Terminal Size Ownership lease duration. @default 15000 */
  ownershipLeaseMs?: number;
  /**
   * Override the session runtime used to spawn the PTY process.
   * Intended for testing: inject a fake runtime to control which shell is
   * spawned without relying on `$SHELL` / `COMSPEC` environment variables.
   */
  runtime?: SessionRuntime;
}

export interface LocalTerminalSink {
  onOutput(data: string): void;
  onExit?(event: ExitEvent): void;
  onError?(error: unknown): void;
}

export interface LocalTerminalAttachment extends IDisposable {
  input(data: string): void;
  resize(cols: number, rows: number): void;
}

interface LocalTerminalState {
  readonly sink: LocalTerminalSink;
  deactivate(): void;
}

interface SizeClaimant {
  readonly sequence: number;
  leaseTimer?: ReturnType<typeof setTimeout>;
}

/**
 * A live terminal session: one backend plus the WebSocket clients currently
 * streaming its output. Create one, attach clients as they connect, and call
 * {@link Session.dispose} to tear it down.
 */
export class Session {
  private readonly backend: SessionBackend;
  private readonly screen: CanonicalTerminalScreen;
  private readonly alertDetector: AlertDetector;
  private readonly auth?: AuthManager;
  private readonly rpc?: Pick<RpcRouter, 'handle'>;
  private readonly handshakeTimeoutMs: number;
  private readonly maxActiveRpcRequests: number;
  private readonly subscribers = new Set<WebSocket>();
  private readonly pendingLatencyTags = new Map<WebSocket, string[]>();
  private readonly activeRpcRequests = new Map<WebSocket, Map<string, AbortController>>();
  private readonly pendingScrollback = new Map<WebSocket, string>();
  private readonly exitListeners = new Set<(event: ExitEvent) => void>();
  private readonly authenticatedListeners = new Set<() => void>();
  private localTerminal?: LocalTerminalState;
  private currentCols: number;
  private currentRows: number;
  private stationCols: number;
  private stationRows: number;
  private sizeOwner?: WebSocket;
  private readonly sizeClaimants = new Map<WebSocket, SizeClaimant>();
  private sizeClaimSequence = 0;
  private readonly ownershipLeaseMs: number;
  private readonly onDataDisposable: IDisposable;
  private readonly onExitDisposable: IDisposable;
  private exited = false;
  private exitEvent?: ExitEvent;
  private scrollbackTransferSequence = 0;

  constructor(opts: SessionOptions = {}) {
    const {
      auth,
      rpc,
      backend,
      runtime,
      handshakeTimeoutMs = 10_000,
      maxActiveRpcRequests = DEFAULT_MAX_ACTIVE_RPC_REQUESTS,
      ownershipLeaseMs = 15_000,
      cols = 120,
      rows = 40,
      ...spawnOpts
    } = opts;
    this.auth = auth;
    this.rpc = rpc;
    this.handshakeTimeoutMs = handshakeTimeoutMs;
    this.maxActiveRpcRequests = maxActiveRpcRequests;
    if (!Number.isInteger(ownershipLeaseMs) || ownershipLeaseMs < 1) {
      throw new RangeError('ownershipLeaseMs must be a positive integer');
    }
    this.ownershipLeaseMs = ownershipLeaseMs;
    this.currentCols = cols;
    this.currentRows = rows;
    this.stationCols = cols;
    this.stationRows = rows;
    this.backend = backend ?? new BareBackend({ ...spawnOpts, cols, rows }, runtime);
    this.screen = new CanonicalTerminalScreen(cols, rows);
    this.alertDetector = new TerminalAlertDetector((message) =>
      this.broadcast({ type: 'alert', message }),
    );

    let initializingScreen = true;
    const pendingInitialOutput: string[] = [];
    const acceptBackendOutput = (data: string): void => {
      this.deliverLocalOutput(data);
      this.screen.write(data, () => {
        this.broadcast({ type: 'output', data });
        this.alertDetector.push(data);
      });
    };
    this.onDataDisposable = this.backend.onData((data) => {
      if (initializingScreen) pendingInitialOutput.push(data);
      else acceptBackendOutput(data);
    });
    const initialOutput = this.backend.captureVisibleScreen();
    if (initialOutput.length > 0) this.screen.write(initialOutput);
    initializingScreen = false;
    for (const data of pendingInitialOutput) acceptBackendOutput(data);

    this.onExitDisposable = this.backend.onExit((event) => this.handleExit(event));
  }

  /** Whether the underlying PTY has exited. */
  get closed(): boolean {
    return this.exited;
  }

  /**
   * Attach a WebSocket client to this session. If auth is configured, the
   * client must complete the handshake (hello → hello-ack → auth-challenge →
   * auth-response) before PTY output is streamed and input is accepted.
   * When the socket closes or errors the client is detached; the PTY keeps
   * running.
   */
  attach(ws: WebSocket): void {
    if (this.auth) {
      this.startHandshake(ws);
    } else {
      this.attachAuthenticated(ws);
    }
  }

  /** Attach the interactive terminal hosted by this CLI process. */
  attachLocalTerminal(sink: LocalTerminalSink): LocalTerminalAttachment {
    if (this.localTerminal) throw new Error('A local workstation terminal is already attached');

    const replay = this.backend.readScrollback();
    if (replay.length > 0) sink.onOutput(replay);

    if (this.exited) {
      if (this.exitEvent) sink.onExit?.(this.exitEvent);
      return {
        input() {},
        resize() {},
        dispose() {},
      };
    }

    let active = true;
    const state: LocalTerminalState = {
      sink,
      deactivate: () => {
        active = false;
      },
    };
    this.localTerminal = state;
    return {
      input: (data) => {
        if (active && !this.exited) this.backend.write(data);
      },
      resize: (cols, rows) => {
        if (active && !this.exited) this.applyStationResize(cols, rows);
      },
      dispose: () => {
        if (!active) return;
        state.deactivate();
        if (this.localTerminal === state) this.localTerminal = undefined;
      },
    };
  }

  /** Observe the shared terminal process exiting, including in headless mode. */
  onExit(listener: (event: ExitEvent) => void): IDisposable {
    if (this.exitEvent) {
      listener(this.exitEvent);
      return { dispose() {} };
    }
    this.exitListeners.add(listener);
    return { dispose: () => this.exitListeners.delete(listener) };
  }

  /** Observe a phone completing authentication and becoming ready for terminal I/O. */
  onAuthenticatedClient(listener: () => void): IDisposable {
    this.authenticatedListeners.add(listener);
    return { dispose: () => this.authenticatedListeners.delete(listener) };
  }

  // -------------------------------------------------------------------------
  // Handshake: hello → hello-ack → auth-challenge → auth-response
  // -------------------------------------------------------------------------

  private startHandshake(ws: WebSocket): void {
    const timeout = setTimeout(() => {
      ws.close(WS_CLOSE_CODES.HANDSHAKE_TIMEOUT, 'handshake timeout');
    }, this.handshakeTimeoutMs);
    const clearHandshakeTimeout = (): void => clearTimeout(timeout);
    ws.once('close', clearHandshakeTimeout);
    ws.once('error', clearHandshakeTimeout);

    const onMessage = (data: RawData): void => {
      let frame: Frame;
      try {
        frame = decodeFrame(rawToUtf8(data));
      } catch {
        this.sendTo(ws, {
          type: 'output',
          data: 'mobily: malformed frame\r\n',
        });
        ws.close(WS_CLOSE_CODES.MALFORMED_FRAME, 'malformed frame');
        return;
      }

      if (frame.type !== 'hello') {
        this.sendTo(ws, {
          type: 'output',
          data: 'mobily: expected hello frame first\r\n',
        });
        ws.close(WS_CLOSE_CODES.PROTOCOL_ERROR, 'protocol error');
        return;
      }

      ws.off('message', onMessage);
      this.handleHello(ws, frame.protocolVersion, clearHandshakeTimeout);
    };

    ws.on('message', onMessage);
    ws.on('close', () => ws.off('message', onMessage));
    ws.on('error', () => ws.off('message', onMessage));
  }

  private handleHello(
    ws: WebSocket,
    clientVersion: number,
    clearHandshakeTimeout: () => void,
  ): void {
    if (clientVersion !== PROTOCOL_VERSION) {
      this.sendTo(ws, {
        type: 'output',
        data:
          `mobily: protocol version mismatch ` +
          `(client ${clientVersion}, server ${PROTOCOL_VERSION}). ` +
          `Please update.\r\n`,
      });
      ws.close(WS_CLOSE_CODES.VERSION_MISMATCH, 'version mismatch');
      return;
    }

    this.sendTo(ws, { type: 'hello-ack', protocolVersion: PROTOCOL_VERSION });
    this.startAuthChallenge(ws, clearHandshakeTimeout);
  }

  private startAuthChallenge(ws: WebSocket, clearHandshakeTimeout: () => void): void {
    const nonce = this.auth!.createChallenge();
    this.sendTo(ws, { type: 'auth-challenge', nonce });

    const onMessage = (data: RawData): void => {
      let frame: Frame;
      try {
        frame = decodeFrame(rawToUtf8(data));
      } catch {
        this.sendTo(ws, {
          type: 'output',
          data: 'mobily: malformed frame\r\n',
        });
        ws.close(WS_CLOSE_CODES.MALFORMED_FRAME, 'malformed frame');
        return;
      }

      if (frame.type !== 'auth-response') {
        this.sendTo(ws, {
          type: 'output',
          data: 'mobily: expected auth-response frame\r\n',
        });
        ws.close(WS_CLOSE_CODES.PROTOCOL_ERROR, 'protocol error');
        return;
      }

      ws.off('message', onMessage);

      const verified = this.auth!.verifyResponse(frame.deviceId, nonce, frame.signature);

      if (!verified) {
        this.sendTo(ws, {
          type: 'output',
          data: 'mobily: authentication failed — device not recognized. Scan QR to re-pair.\r\n',
        });
        ws.close(WS_CLOSE_CODES.AUTH_REJECTED, 'auth failed');
        return;
      }

      clearHandshakeTimeout();
      this.sendTo(ws, { type: 'auth-ok' });
      this.attachAuthenticated(ws);
    };

    ws.on('message', onMessage);
    ws.on('close', () => ws.off('message', onMessage));
    ws.on('error', () => ws.off('message', onMessage));
  }

  // -------------------------------------------------------------------------
  // Authenticated: PTY ↔ client
  // -------------------------------------------------------------------------

  private attachAuthenticated(ws: WebSocket): void {
    this.sendSizeOwnershipState(ws);
    this.sendTo(ws, { type: 'resize', cols: this.currentCols, rows: this.currentRows });
    this.pendingLatencyTags.set(ws, []);
    this.activeRpcRequests.set(ws, new Map());
    ws.on('message', (data) => this.handleMessage(ws, data));
    let detached = false;
    const detach = (): void => {
      if (detached) return;
      detached = true;
      this.releaseSizeClaim(ws);
      this.subscribers.delete(ws);
      this.pendingLatencyTags.delete(ws);
      this.pendingScrollback.delete(ws);
      for (const controller of this.activeRpcRequests.get(ws)?.values() ?? []) controller.abort();
      this.activeRpcRequests.delete(ws);
    };
    ws.on('close', detach);
    ws.on('error', detach);
    this.screen.capture((snapshot) => {
      if (detached || ws.readyState !== READY_STATE_OPEN) return;
      this.pendingScrollback.set(
        ws,
        this.backend.readScrollback().slice(-MAX_SESSION_SCROLLBACK_CHARS),
      );
      this.sendTo(ws, snapshot);
      this.subscribers.add(ws);
      for (const listener of [...this.authenticatedListeners]) {
        try {
          listener();
        } catch {
          // Connection readiness must not depend on an observer.
        }
      }
    });
  }

  private handleMessage(ws: WebSocket, data: RawData): void {
    let frame: Frame;
    try {
      frame = decodeFrame(rawToUtf8(data));
    } catch {
      this.sendTo(ws, {
        type: 'output',
        data: 'mobily: malformed frame\r\n',
      });
      ws.close(WS_CLOSE_CODES.MALFORMED_FRAME, 'malformed frame');
      return;
    }

    switch (frame.type) {
      case 'input':
        if (frame.latencyTag) {
          const tags = this.pendingLatencyTags.get(ws);
          if (tags) {
            tags.push(frame.latencyTag);
            if (tags.length > 256) tags.splice(0, tags.length - 256);
          }
        }
        this.backend.write(frame.data);
        break;
      case 'resize':
        if (this.sizeOwner !== ws) {
          this.sendSizeOwnershipState(ws);
          break;
        }
        try {
          this.applyResize(frame.cols, frame.rows);
          this.renewSizeOwnershipLease(ws);
        } catch (err) {
          this.sendTo(ws, {
            type: 'output',
            data: `mobily: resize failed — ${errorText(err)}\r\n`,
          });
        }
        break;
      case 'rpc':
        if ('method' in frame) this.handleRpc(ws, frame);
        else ws.close(WS_CLOSE_CODES.PROTOCOL_ERROR, 'unexpected RPC response');
        break;
      case 'rpc-stream':
        ws.close(WS_CLOSE_CODES.PROTOCOL_ERROR, 'unexpected RPC stream');
        break;
      case 'alert':
        ws.close(WS_CLOSE_CODES.PROTOCOL_ERROR, 'unexpected alert frame');
        break;
      case 'session-snapshot':
        ws.close(WS_CLOSE_CODES.PROTOCOL_ERROR, 'unexpected Session Snapshot');
        break;
      case 'session-snapshot-applied':
        this.sendPendingScrollback(ws);
        break;
      case 'session-scrollback':
        ws.close(WS_CLOSE_CODES.PROTOCOL_ERROR, 'unexpected Session scrollback');
        break;
      case 'terminal-size-claim':
        this.claimSizeOwnership(ws);
        break;
      case 'terminal-size-release':
        this.releaseSizeClaim(ws);
        break;
      case 'terminal-size-owner':
        ws.close(WS_CLOSE_CODES.PROTOCOL_ERROR, 'unexpected Terminal Size Owner state');
        break;
      case 'output':
        break;
      case 'hello':
      case 'hello-ack':
      case 'auth-challenge':
      case 'auth-response':
      case 'auth-ok':
        break;
    }
  }

  private sendPendingScrollback(ws: WebSocket): void {
    const history = this.pendingScrollback.get(ws);
    if (history === undefined) {
      ws.close(WS_CLOSE_CODES.PROTOCOL_ERROR, 'unexpected Session Snapshot acknowledgement');
      return;
    }
    this.pendingScrollback.delete(ws);
    const transferId = `history-${++this.scrollbackTransferSequence}`;
    if (history.length === 0) {
      this.sendTo(ws, {
        type: 'session-scrollback',
        transferId,
        sequence: 0,
        data: '',
        done: true,
      });
      return;
    }
    let sequence = 0;
    for (let offset = 0; offset < history.length; offset += MAX_SESSION_SCROLLBACK_CHUNK_CHARS) {
      const data = history.slice(offset, offset + MAX_SESSION_SCROLLBACK_CHUNK_CHARS);
      this.sendTo(ws, {
        type: 'session-scrollback',
        transferId,
        sequence: sequence++,
        data,
        done: offset + data.length >= history.length,
      });
    }
  }

  private claimSizeOwnership(ws: WebSocket): void {
    const existing = this.sizeClaimants.get(ws);
    if (existing) {
      this.renewSizeOwnershipLease(ws, existing);
      return;
    }
    const claimant: SizeClaimant = {
      sequence: ++this.sizeClaimSequence,
    };
    this.sizeClaimants.set(ws, claimant);
    this.sizeOwner = ws;
    this.renewSizeOwnershipLease(ws, claimant);
    this.broadcastSizeOwnershipState();
  }

  private renewSizeOwnershipLease(ws: WebSocket, claimant = this.sizeClaimants.get(ws)): void {
    if (!claimant) return;
    clearTimeout(claimant.leaseTimer);
    claimant.leaseTimer = setTimeout(() => this.releaseSizeClaim(ws), this.ownershipLeaseMs);
    claimant.leaseTimer.unref?.();
  }

  private releaseSizeClaim(ws: WebSocket): void {
    const claimant = this.sizeClaimants.get(ws);
    if (!claimant) return;
    clearTimeout(claimant.leaseTimer);
    this.sizeClaimants.delete(ws);
    if (this.sizeOwner !== ws) return;

    this.sizeOwner = this.mostRecentSizeClaimant();
    if (this.sizeOwner) {
      this.broadcastSizeOwnershipState();
      return;
    }
    try {
      if (this.currentCols !== this.stationCols || this.currentRows !== this.stationRows) {
        this.applyResize(this.stationCols, this.stationRows);
      }
    } catch (error) {
      this.broadcast({
        type: 'output',
        data: `mobily: failed to restore Station dimensions — ${errorText(error)}\r\n`,
      });
    } finally {
      this.broadcastSizeOwnershipState();
    }
  }

  private mostRecentSizeClaimant(): WebSocket | undefined {
    let newest: { ws: WebSocket; sequence: number } | undefined;
    for (const [ws, claimant] of this.sizeClaimants) {
      if (!newest || claimant.sequence > newest.sequence) {
        newest = { ws, sequence: claimant.sequence };
      }
    }
    return newest?.ws;
  }

  private broadcastSizeOwnershipState(): void {
    for (const viewer of this.pendingLatencyTags.keys()) this.sendSizeOwnershipState(viewer);
  }

  private sendSizeOwnershipState(ws: WebSocket): void {
    this.sendTo(ws, {
      type: 'terminal-size-owner',
      owner: this.sizeOwner ? 'android' : 'station',
      ownedByRequester: this.sizeOwner === ws,
    });
  }

  private handleRpc(ws: WebSocket, frame: Extract<Frame, { type: 'rpc'; method: string }>): void {
    if (!this.rpc) {
      this.sendTo(ws, {
        type: 'rpc',
        id: frame.id,
        error: { code: 'METHOD_NOT_FOUND', message: 'Structured RPC is not enabled' },
      });
      return;
    }
    const active = this.activeRpcRequests.get(ws);
    if (!active) return;
    if (active.has(frame.id)) {
      this.sendTo(ws, {
        type: 'rpc',
        id: frame.id,
        error: { code: 'DUPLICATE_REQUEST', message: 'RPC request id is already active' },
      });
      return;
    }
    if (active.size >= this.maxActiveRpcRequests) {
      const error = { code: 'BUSY', message: 'Too many active RPC requests' };
      if (frame.method === GIT_RPC_METHODS.DIFF) {
        this.sendTo(ws, { type: 'rpc-stream', id: frame.id, chunk: '', done: true, error });
      } else {
        this.sendTo(ws, { type: 'rpc', id: frame.id, error });
      }
      return;
    }
    const controller = new AbortController();
    active.set(frame.id, controller);
    void this.rpc
      .handle(frame, (outbound) => this.sendTo(ws, outbound), controller.signal)
      .finally(() => active.delete(frame.id));
  }

  // -------------------------------------------------------------------------
  // Outbound: PTY → clients
  // -------------------------------------------------------------------------

  private broadcast(frame: OutputFrame | AlertFrame | ResizeFrame): void {
    for (const ws of [...this.subscribers]) {
      if (frame.type === 'output') {
        const latencyTags = this.pendingLatencyTags.get(ws)?.splice(0);
        this.sendRaw(ws, encodeFrame(latencyTags?.length ? { ...frame, latencyTags } : frame));
      } else {
        this.sendRaw(ws, encodeFrame(frame));
      }
    }
  }

  private deliverLocalOutput(data: string): void {
    if (!this.localTerminal) return;
    const state = this.localTerminal;
    try {
      state.sink.onOutput(data);
    } catch (error) {
      state.deactivate();
      if (this.localTerminal === state) this.localTerminal = undefined;
      try {
        state.sink.onError?.(error);
      } catch {
        // A failed local sink must not interrupt remote clients.
      }
    }
  }

  private applyResize(cols: number, rows: number): void {
    this.backend.resize(cols, rows);
    this.screen.resize(cols, rows, () => this.broadcast({ type: 'resize', cols, rows }));
    this.currentCols = cols;
    this.currentRows = rows;
  }

  private applyStationResize(cols: number, rows: number): void {
    this.stationCols = cols;
    this.stationRows = rows;
    if (!this.sizeOwner) this.applyResize(cols, rows);
  }

  private sendTo(ws: WebSocket, frame: Frame): void {
    this.sendRaw(ws, encodeFrame(frame));
  }

  private sendRaw(ws: WebSocket, raw: string): void {
    if (ws.readyState !== READY_STATE_OPEN) return;
    if (ws.bufferedAmount + Buffer.byteLength(raw, 'utf8') > MAX_BUFFERED_OUTPUT_BYTES) {
      ws.close(1013, 'client is too slow');
      this.subscribers.delete(ws);
      return;
    }
    try {
      ws.send(raw);
    } catch {
      this.subscribers.delete(ws);
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  private handleExit(event: ExitEvent): void {
    this.exited = true;
    this.exitEvent = event;
    this.clearSizeClaimants();
    this.sizeOwner = undefined;
    const localTerminal = this.localTerminal;
    this.localTerminal = undefined;
    localTerminal?.deactivate();
    try {
      localTerminal?.sink.onExit?.(event);
    } catch {
      // One local observer must not prevent the remaining exit cleanup.
    }
    const exitListeners = [...this.exitListeners];
    this.exitListeners.clear();
    this.authenticatedListeners.clear();
    for (const listener of exitListeners) {
      try {
        listener(event);
      } catch {
        // Exit observers are isolated from each other and WebSocket cleanup.
      }
    }
    for (const ws of this.subscribers) {
      try {
        ws.close(1000, 'pty exited');
      } catch {
        // Already closed — ignore.
      }
    }
  }

  /** Tear down: stop listening, close clients, and dispose the backend. */
  dispose(): void {
    this.exited = true;
    this.onDataDisposable.dispose();
    this.onExitDisposable.dispose();
    this.alertDetector.dispose();
    this.screen.dispose();
    for (const ws of this.subscribers) {
      try {
        ws.close(1001, 'session disposed');
      } catch {
        // Already closed — ignore.
      }
    }
    this.subscribers.clear();
    this.localTerminal?.deactivate();
    this.localTerminal = undefined;
    this.exitListeners.clear();
    this.pendingLatencyTags.clear();
    for (const active of this.activeRpcRequests.values()) {
      for (const controller of active.values()) controller.abort();
    }
    this.activeRpcRequests.clear();
    this.clearSizeClaimants();
    this.sizeOwner = undefined;
    try {
      this.backend.dispose();
    } catch {
      // Already dead — ignore.
    }
  }

  private clearSizeClaimants(): void {
    for (const claimant of this.sizeClaimants.values()) clearTimeout(claimant.leaseTimer);
    this.sizeClaimants.clear();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rawToUtf8(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
