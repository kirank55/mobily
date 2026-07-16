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
  PROTOCOL_VERSION,
  WS_CLOSE_CODES,
  type AlertFrame,
  type Frame,
  type OutputFrame,
} from '@mobily/shared';
import type { ExitEvent, IDisposable, SpawnOptions } from './pty/node-pty.js';
import type { AuthManager } from './auth.js';
import type { RpcRouter } from './rpc/router.js';
import { BareBackend } from './mux/bare.js';
import type { SessionBackend } from './mux/types.js';
import type { SessionRuntime } from './mux/runtime.js';
import { TerminalAlertDetector, type AlertDetector } from './alerts/detector.js';

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
  private readonly alertDetector: AlertDetector;
  private readonly auth?: AuthManager;
  private readonly rpc?: Pick<RpcRouter, 'handle'>;
  private readonly handshakeTimeoutMs: number;
  private readonly maxActiveRpcRequests: number;
  private readonly subscribers = new Set<WebSocket>();
  private readonly pendingLatencyTags = new Map<WebSocket, string[]>();
  private readonly activeRpcRequests = new Map<WebSocket, Map<string, AbortController>>();
  private readonly exitListeners = new Set<(event: ExitEvent) => void>();
  private localTerminal?: LocalTerminalState;
  private readonly onDataDisposable: IDisposable;
  private readonly onExitDisposable: IDisposable;
  private exited = false;
  private exitEvent?: ExitEvent;

  constructor(opts: SessionOptions = {}) {
    const {
      auth,
      rpc,
      backend,
      runtime,
      handshakeTimeoutMs = 10_000,
      maxActiveRpcRequests = DEFAULT_MAX_ACTIVE_RPC_REQUESTS,
      ...spawnOpts
    } = opts;
    this.auth = auth;
    this.rpc = rpc;
    this.handshakeTimeoutMs = handshakeTimeoutMs;
    this.maxActiveRpcRequests = maxActiveRpcRequests;
    this.backend = backend ?? new BareBackend(spawnOpts, runtime);
    this.alertDetector = new TerminalAlertDetector((message) =>
      this.broadcast({ type: 'alert', message }),
    );

    this.onDataDisposable = this.backend.onData((data) => {
      this.broadcast({ type: 'output', data });
      this.alertDetector.push(data);
    });

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
        if (active && !this.exited) this.backend.resize(cols, rows);
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
    const replay = this.backend.readScrollback();
    if (replay.length > 0) this.sendTo(ws, { type: 'output', data: replay });
    this.subscribers.add(ws);
    this.pendingLatencyTags.set(ws, []);
    this.activeRpcRequests.set(ws, new Map());
    ws.on('message', (data) => this.handleMessage(ws, data));
    const detach = (): void => {
      this.subscribers.delete(ws);
      this.pendingLatencyTags.delete(ws);
      for (const controller of this.activeRpcRequests.get(ws)?.values() ?? []) controller.abort();
      this.activeRpcRequests.delete(ws);
    };
    ws.on('close', detach);
    ws.on('error', detach);
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
        if (this.localTerminal) break;
        try {
          this.backend.resize(frame.cols, frame.rows);
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

  private broadcast(frame: OutputFrame | AlertFrame): void {
    if (frame.type === 'output' && this.localTerminal) {
      const state = this.localTerminal;
      try {
        state.sink.onOutput(frame.data);
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
    for (const ws of [...this.subscribers]) {
      if (frame.type === 'output') {
        const latencyTags = this.pendingLatencyTags.get(ws)?.splice(0);
        this.sendRaw(ws, encodeFrame(latencyTags?.length ? { ...frame, latencyTags } : frame));
      } else {
        this.sendRaw(ws, encodeFrame(frame));
      }
    }
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
    try {
      this.backend.dispose();
    } catch {
      // Already dead — ignore.
    }
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
