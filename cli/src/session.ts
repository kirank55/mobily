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
 * When no AuthManager is provided (e.g. unit tests), the handshake is
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
  WS_CLOSE_CODES,
  type AlertFrame,
  type Frame,
  type OutputFrame,
  type ResizeFrame,
  type SessionStatusFrame,
} from '@mobily/shared';
import type { ExitEvent, IDisposable, SpawnOptions } from './pty.js';
import type { AuthManager } from './auth.js';
import type { RpcRouter } from './rpcRouter.js';
import { BareBackend } from './sessionBackend/bare.js';
import type { SessionBackend } from './sessionBackend/types.js';
import type { SessionRuntime } from './sessionBackend/runtime.js';
import type { AlertDetector } from './alerts/detector.js';
import { SessionPhaseTracker } from './alerts/phase.js';
import { CanonicalTerminalScreen } from './terminalScreen.js';
import { SessionHandshake } from './sessionHandshake.js';
import { SessionScrollback } from './sessionScrollback.js';
import { SessionSizeOwnership, type SizeClaimant } from './sessionSize.js';
import { errorText, rawToUtf8 } from './sessionUtils.js';

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
  private authenticatedClientSeen = false;
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
  private readonly handshake?: SessionHandshake;
  private readonly scrollback: SessionScrollback;
  private readonly sizeOwnership: SessionSizeOwnership;

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
    this.alertDetector = new SessionPhaseTracker({
      onPhase: (phase, detail) =>
        this.broadcast({
          type: 'session-status',
          phase,
          ...(detail === undefined ? {} : { detail }),
        }),
      onAlert: (message) => this.broadcast({ type: 'alert', message }),
    });
    if (auth) {
      this.handshake = new SessionHandshake({
        auth,
        handshakeTimeoutMs: this.handshakeTimeoutMs,
        sendTo: (ws, frame) => this.sendTo(ws, frame),
        attachAuthenticated: (ws) => this.attachAuthenticated(ws),
      });
    }
    this.scrollback = new SessionScrollback({
      sendTo: (ws, frame) => this.sendTo(ws, frame),
      getPendingScrollback: (ws) => this.pendingScrollback.get(ws),
      deletePendingScrollback: (ws) => this.pendingScrollback.delete(ws),
      nextTransferId: () => `history-${++this.scrollbackTransferSequence}`,
    });
    this.sizeOwnership = new SessionSizeOwnership({
      ownershipLeaseMs: this.ownershipLeaseMs,
      getSizeOwner: () => this.sizeOwner,
      setSizeOwner: (value) => {
        this.sizeOwner = value;
      },
      sizeClaimants: this.sizeClaimants,
      nextClaimSequence: () => ++this.sizeClaimSequence,
      getCurrentCols: () => this.currentCols,
      getCurrentRows: () => this.currentRows,
      getStationCols: () => this.stationCols,
      getStationRows: () => this.stationRows,
      sendTo: (ws, frame) => this.sendTo(ws, frame),
      broadcast: (frame) => this.broadcast(frame),
      applyResize: (cols, rows) => this.applyResize(cols, rows),
      forEachViewer: (callback) => {
        for (const viewer of this.pendingLatencyTags.keys()) callback(viewer);
      },
    });

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
    if (this.handshake) {
      this.handshake.startHandshake(ws);
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

  /**
   * Observe a phone completing authentication, immediately before Session Snapshot
   * capture. Listeners may mutate the Session; those mutations are included in the
   * snapshot and must not run after it (ADR-0004).
   *
   * If a viewer has already authenticated, the listener runs once immediately.
   */
  onAuthenticatedClient(listener: () => void): IDisposable {
    this.authenticatedListeners.add(listener);
    if (this.authenticatedClientSeen) {
      try {
        listener();
      } catch {
        // Connection readiness must not depend on an observer.
      }
    }
    return { dispose: () => this.authenticatedListeners.delete(listener) };
  }

  // -------------------------------------------------------------------------
  // Authenticated viewer attach (ADR-0004):
  // auth-ok → prepare (workstation) → size owner → dimensions → freeze →
  // snapshot → subscribe → live I/O → scrollback after ack
  // -------------------------------------------------------------------------

  private attachAuthenticated(ws: WebSocket): void {
    this.pendingLatencyTags.set(ws, []);
    this.activeRpcRequests.set(ws, new Map());
    let detached = false;
    let attachReady = false;
    const inboundQueue: RawData[] = [];
    const messageHandler = (data: RawData): void => {
      if (!attachReady) {
        inboundQueue.push(data);
        return;
      }
      this.handleMessage(ws, data);
    };
    const detach = (): void => {
      if (detached) return;
      detached = true;
      ws.off('message', messageHandler);
      this.sizeOwnership.releaseSizeClaim(ws);
      this.subscribers.delete(ws);
      this.pendingLatencyTags.delete(ws);
      this.pendingScrollback.delete(ws);
      for (const controller of this.activeRpcRequests.get(ws)?.values() ?? []) controller.abort();
      this.activeRpcRequests.delete(ws);
    };
    ws.on('message', messageHandler);
    ws.on('close', detach);
    ws.on('error', detach);

    // Workstation presence and other observers run before capture so their
    // Session mutations are frozen into the snapshot, not streamed as live output.
    this.notifyAuthenticatedClient();

    this.sizeOwnership.sendSizeOwnershipState(ws);
    this.sendTo(ws, { type: 'resize', cols: this.currentCols, rows: this.currentRows });
    this.screen.capture((snapshot) => {
      if (detached || this.exited || ws.readyState !== READY_STATE_OPEN) {
        detach();
        if (ws.readyState === READY_STATE_OPEN) {
          try {
            ws.close(1000, this.exited ? 'pty exited' : 'session disposed');
          } catch {
            // Already closed — ignore.
          }
        }
        return;
      }
      this.pendingScrollback.set(
        ws,
        this.backend.readScrollback().slice(-MAX_SESSION_SCROLLBACK_CHARS),
      );
      this.sendTo(ws, snapshot);
      this.subscribers.add(ws);
      // Flush queued frames only after the snapshot is on the wire so size
      // claims cannot resize the Session underneath the initial screen.
      attachReady = true;
      for (const data of inboundQueue) {
        if (detached) return;
        this.handleMessage(ws, data);
      }
      inboundQueue.length = 0;
    });
  }

  private notifyAuthenticatedClient(): void {
    this.authenticatedClientSeen = true;
    for (const listener of [...this.authenticatedListeners]) {
      try {
        listener();
      } catch {
        // Connection readiness must not depend on an observer.
      }
    }
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
          this.sizeOwnership.sendSizeOwnershipState(ws);
          break;
        }
        try {
          this.applyResize(frame.cols, frame.rows);
          this.sizeOwnership.renewSizeOwnershipLease(ws);
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
      case 'session-status':
        ws.close(WS_CLOSE_CODES.PROTOCOL_ERROR, 'unexpected session-status frame');
        break;
      case 'session-snapshot':
        ws.close(WS_CLOSE_CODES.PROTOCOL_ERROR, 'unexpected Session Snapshot');
        break;
      case 'session-snapshot-applied':
        this.scrollback.sendPendingScrollback(ws);
        break;
      case 'session-scrollback':
        ws.close(WS_CLOSE_CODES.PROTOCOL_ERROR, 'unexpected Session scrollback');
        break;
      case 'terminal-size-claim':
        this.sizeOwnership.claimSizeOwnership(ws);
        break;
      case 'terminal-size-release':
        this.sizeOwnership.releaseSizeClaim(ws);
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

  private broadcast(
    frame: OutputFrame | AlertFrame | SessionStatusFrame | ResizeFrame,
  ): void {
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
    this.sizeOwnership.clearSizeClaimants();
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
    this.closeAttachedViewers(1000, 'pty exited');
  }

  /** Tear down: stop listening, close clients, and dispose the backend. */
  dispose(): void {
    this.exited = true;
    this.onDataDisposable.dispose();
    this.onExitDisposable.dispose();
    this.alertDetector.dispose();
    this.screen.dispose();
    this.closeAttachedViewers(1001, 'session disposed');
    this.localTerminal?.deactivate();
    this.localTerminal = undefined;
    this.exitListeners.clear();
    this.authenticatedListeners.clear();
    for (const active of this.activeRpcRequests.values()) {
      for (const controller of active.values()) controller.abort();
    }
    this.activeRpcRequests.clear();
    this.sizeOwnership.clearSizeClaimants();
    this.sizeOwner = undefined;
    try {
      this.backend.dispose();
    } catch {
      // Already dead — ignore.
    }
  }

  /** Close live subscribers and viewers still inside the post-auth capture window. */
  private closeAttachedViewers(code: number, reason: string): void {
    const viewers = new Set([...this.subscribers, ...this.pendingLatencyTags.keys()]);
    this.subscribers.clear();
    this.pendingLatencyTags.clear();
    this.pendingScrollback.clear();
    for (const ws of viewers) {
      try {
        ws.close(code, reason);
      } catch {
        // Already closed — ignore.
      }
    }
  }
}
