/**
 * cli/src/session.ts
 *
 * Glue between a single PTY process and the WebSocket clients attached to it.
 *
 * Phase 1 behaviour (bare): the Session holds the {@link PtyProcess} directly,
 * so the terminal survives WebSocket disconnects — a new client reattaches to
 * the same live PTY. The `SessionBackend` abstraction + `TmuxBackend` arrive in
 * Phase 5, when tmux's crash-survival benefit is first exercised.
 *
 * Frame encoding/decoding uses the shared wire protocol (see
 * `shared/src/protocol.ts`). Only `input` and `resize` frames are accepted from
 * clients; PTY output is broadcast to every attached client as `output` frames.
 * Scrollback is NOT replayed to a reconnecting client in Phase 1 (deferred to
 * Phase 5 alongside the ring buffer / `capture-pane` work).
 */

import type { RawData, WebSocket } from 'ws';
import {
  decodeFrame,
  encodeFrame,
  type OutputFrame,
} from '@mobily/shared';
import { spawn, type IDisposable, type PtyProcess, type SpawnOptions } from './pty/node-pty.js';

/** `ws.WebSocket` readyState value for an open connection. */
const READY_STATE_OPEN = 1;

/**
 * A live terminal session: one PTY plus the WebSocket clients currently
 * streaming its output. Create one, attach clients as they connect, and call
 * {@link Session.dispose} to tear it down.
 */
export class Session {
  /** The PTY held by this session. Exposed for inspection / testing. */
  readonly pty: PtyProcess;

  private readonly subscribers = new Set<WebSocket>();
  private readonly onDataDisposable: IDisposable;
  private readonly onExitDisposable: IDisposable;
  private exited = false;

  constructor(opts: SpawnOptions = {}) {
    this.pty = spawn(opts);

    // PTY stdout → every attached client, as `output` frames.
    this.onDataDisposable = this.pty.onData((data) =>
      this.broadcast({ type: 'output', data }),
    );

    // When the shell itself exits, close the attached clients. (This is the
    // PTY dying, not a client leaving — a client leaving never kills the PTY.)
    this.onExitDisposable = this.pty.onExit(() => this.handleExit());
  }

  /** Whether the underlying PTY has exited. */
  get closed(): boolean {
    return this.exited;
  }

  /**
   * Attach a WebSocket client to this session. PTY output is streamed to it and
   * `input` / `resize` frames from it are forwarded to the PTY. When the socket
   * closes or errors the client is detached; the PTY keeps running.
   */
  attach(ws: WebSocket): void {
    this.subscribers.add(ws);
    ws.on('message', (data) => this.handleMessage(ws, data));
    ws.on('close', () => this.subscribers.delete(ws));
    ws.on('error', () => this.subscribers.delete(ws));
  }

  // -------------------------------------------------------------------------
  // Inbound: client → PTY
  // -------------------------------------------------------------------------

  private handleMessage(ws: WebSocket, data: RawData): void {
    let frame;
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
        // `output` is CLI → client only; ignore client-sent output frames.
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Outbound: PTY → clients
  // -------------------------------------------------------------------------

  private broadcast(frame: OutputFrame): void {
    const raw = encodeFrame(frame);
    // Snapshot so a socket that errors mid-broadcast and removes itself from
    // `subscribers` cannot cause us to skip a still-open socket.
    for (const ws of [...this.subscribers]) {
      this.sendRaw(ws, raw);
    }
  }

  private sendTo(ws: WebSocket, frame: OutputFrame): void {
    this.sendRaw(ws, encodeFrame(frame));
  }

  private sendRaw(ws: WebSocket, raw: string): void {
    if (ws.readyState !== READY_STATE_OPEN) return;
    try {
      ws.send(raw);
    } catch {
      // Socket closed between the readyState check and the send — drop it.
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

/**
 * Convert a `ws` inbound message (`RawData`) to a UTF-8 string. `ws` delivers
 * text frames as a single `Buffer`, but the type also permits `ArrayBuffer` and
 * `Buffer[]`, so all three are handled.
 */
function rawToUtf8(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

/** Extract a human-readable message from a thrown value. */
function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
