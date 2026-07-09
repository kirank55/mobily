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
 * The Session holds the {@link PtyProcess} directly (bare behaviour), so the
 * terminal survives WebSocket disconnects — a new client reattaches to the
 * same live PTY after completing the handshake. The `SessionBackend` abstraction
 * + `TmuxBackend` arrive in Phase 5.
 */

import type { RawData, WebSocket } from 'ws';
import {
  decodeFrame,
  encodeFrame,
  PROTOCOL_VERSION,
  type Frame,
  type OutputFrame,
} from '@mobily/shared';
import { spawn, type IDisposable, type PtyProcess, type SpawnOptions } from './pty/node-pty.js';
import type { AuthManager } from './auth.js';

/** `ws.WebSocket` readyState value for an open connection. */
const READY_STATE_OPEN = 1;

/** Extended spawn options — includes optional auth for the handshake. */
export interface SessionOptions extends SpawnOptions {
  /** Auth manager for Device Key challenge-response. If omitted, no auth. */
  auth?: AuthManager;
}

/**
 * A live terminal session: one PTY plus the WebSocket clients currently
 * streaming its output. Create one, attach clients as they connect, and call
 * {@link Session.dispose} to tear it down.
 */
export class Session {
  /** The PTY held by this session. Exposed for inspection / testing. */
  readonly pty: PtyProcess;

  private readonly auth?: AuthManager;
  private readonly subscribers = new Set<WebSocket>();
  private readonly onDataDisposable: IDisposable;
  private readonly onExitDisposable: IDisposable;
  private exited = false;

  constructor(opts: SessionOptions = {}) {
    const { auth, ...spawnOpts } = opts;
    this.auth = auth;
    this.pty = spawn(spawnOpts);

    this.onDataDisposable = this.pty.onData((data) =>
      this.broadcast({ type: 'output', data }),
    );

    this.onExitDisposable = this.pty.onExit(() => this.handleExit());
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

  // -------------------------------------------------------------------------
  // Handshake: hello → hello-ack → auth-challenge → auth-response
  // -------------------------------------------------------------------------

  private startHandshake(ws: WebSocket): void {
    const onMessage = (data: RawData): void => {
      let frame: Frame;
      try {
        frame = decodeFrame(rawToUtf8(data));
      } catch (err) {
        this.sendTo(ws, {
          type: 'output',
          data: `mobily: malformed frame — ${errorText(err)}\r\n`,
        });
        ws.close(4000, 'malformed frame');
        return;
      }

      if (frame.type !== 'hello') {
        this.sendTo(ws, {
          type: 'output',
          data: 'mobily: expected hello frame first\r\n',
        });
        ws.close(4002, 'protocol error');
        return;
      }

      ws.off('message', onMessage);
      this.handleHello(ws, frame.protocolVersion);
    };

    ws.on('message', onMessage);
    ws.on('close', () => ws.off('message', onMessage));
    ws.on('error', () => ws.off('message', onMessage));
  }

  private handleHello(ws: WebSocket, clientVersion: number): void {
    if (clientVersion !== PROTOCOL_VERSION) {
      this.sendTo(ws, {
        type: 'output',
        data:
          `mobily: protocol version mismatch ` +
          `(client ${clientVersion}, server ${PROTOCOL_VERSION}). ` +
          `Please update.\r\n`,
      });
      ws.close(4003, 'version mismatch');
      return;
    }

    this.sendTo(ws, { type: 'hello-ack', protocolVersion: PROTOCOL_VERSION });
    this.startAuthChallenge(ws);
  }

  private startAuthChallenge(ws: WebSocket): void {
    const nonce = this.auth!.createChallenge();
    this.sendTo(ws, { type: 'auth-challenge', nonce });

    const onMessage = (data: RawData): void => {
      let frame: Frame;
      try {
        frame = decodeFrame(rawToUtf8(data));
      } catch (err) {
        this.sendTo(ws, {
          type: 'output',
          data: `mobily: malformed frame — ${errorText(err)}\r\n`,
        });
        ws.close(4000, 'malformed frame');
        return;
      }

      if (frame.type !== 'auth-response') {
        this.sendTo(ws, {
          type: 'output',
          data: 'mobily: expected auth-response frame\r\n',
        });
        ws.close(4002, 'protocol error');
        return;
      }

      ws.off('message', onMessage);

      const verified = this.auth!.verifyResponse(
        frame.deviceId,
        nonce,
        frame.signature,
      );

      if (!verified) {
        this.sendTo(ws, {
          type: 'output',
          data: 'mobily: authentication failed — device not recognized. Scan QR to re-pair.\r\n',
        });
        ws.close(4001, 'auth failed');
        return;
      }

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
    this.subscribers.add(ws);
    ws.on('message', (data) => this.handleMessage(ws, data));
    ws.on('close', () => this.subscribers.delete(ws));
    ws.on('error', () => this.subscribers.delete(ws));
  }

  private handleMessage(ws: WebSocket, data: RawData): void {
    let frame: Frame;
    try {
      frame = decodeFrame(rawToUtf8(data));
    } catch (err) {
      this.sendTo(ws, {
        type: 'output',
        data: `mobily: malformed frame — ${errorText(err)}\r\n`,
      });
      return;
    }

    switch (frame.type) {
      case 'input':
        this.pty.write(frame.data);
        break;
      case 'resize':
        try {
          this.pty.resize(frame.cols, frame.rows);
        } catch (err) {
          this.sendTo(ws, {
            type: 'output',
            data: `mobily: resize failed — ${errorText(err)}\r\n`,
          });
        }
        break;
      case 'output':
        break;
      case 'hello':
      case 'hello-ack':
      case 'auth-challenge':
      case 'auth-response':
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Outbound: PTY → clients
  // -------------------------------------------------------------------------

  private broadcast(frame: OutputFrame): void {
    const raw = encodeFrame(frame);
    for (const ws of [...this.subscribers]) {
      this.sendRaw(ws, raw);
    }
  }

  private sendTo(ws: WebSocket, frame: Frame): void {
    this.sendRaw(ws, encodeFrame(frame));
  }

  private sendRaw(ws: WebSocket, raw: string): void {
    if (ws.readyState !== READY_STATE_OPEN) return;
    try {
      ws.send(raw);
    } catch {
      this.subscribers.delete(ws);
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  private handleExit(): void {
    this.exited = true;
    for (const ws of this.subscribers) {
      try {
        ws.close(1000, 'pty exited');
      } catch {
        // Already closed — ignore.
      }
    }
  }

  /** Tear down: stop listening, close clients, and kill the PTY. */
  dispose(): void {
    this.exited = true;
    this.onDataDisposable.dispose();
    this.onExitDisposable.dispose();
    for (const ws of this.subscribers) {
      try {
        ws.close(1001, 'session disposed');
      } catch {
        // Already closed — ignore.
      }
    }
    this.subscribers.clear();
    try {
      this.pty.kill();
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
