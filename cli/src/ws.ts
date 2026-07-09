/**
 * cli/src/ws.ts
 *
 * WebSocket server that exposes a {@link Session} over `ws://localhost:<port>`.
 * Each inbound connection is attached to the provided Session, which owns the
 * PTY and keeps it alive across client disconnects.
 */

import { WebSocketServer } from 'ws';
import type { Session } from './session.js';

export interface ServerOptions {
  /** Bind host. @default 'localhost' */
  host?: string;
  /** Bind port; `0` selects an ephemeral port. @default 0 */
  port?: number;
  /** Session that inbound connections attach to. */
  session: Session;
}

export interface Server {
  /** The host the server is bound to. */
  readonly host: string;
  /** The port the server is listening on (resolved when `port` was `0`). */
  readonly port: number;
  /** `ws://<host>:<port>` URL clients can connect to. */
  readonly url: string;
  /**
   * Close all connected clients and stop listening. Resolves once the
   * underlying server is closed (or after a short fallback window so it never
   * hangs on a stuck socket).
   */
  close(): Promise<void>;
}

/**
 * Start a WebSocket server bound to `host:port`. Resolves once it is listening.
 * Inbound connections are attached to `options.session`.
 */
export function startServer(options: ServerOptions): Promise<Server> {
  const host = options.host ?? 'localhost';
  const port = options.port ?? 0;
  const wss = new WebSocketServer({ host, port });

  wss.on('connection', (ws) => options.session.attach(ws));

  return new Promise<Server>((resolve, reject) => {
    wss.once('error', reject);
    wss.once('listening', () => {
      const addr = wss.address();
      const boundPort =
        typeof addr === 'object' && addr !== null ? addr.port : port;

      resolve({
        host,
        port: boundPort,
        url: `ws://${host}:${boundPort}`,
        close: () => closeServer(wss),
      });
    });
  });
}

/** Close a `WebSocketServer`, terminating connected clients first. */
function closeServer(wss: WebSocketServer): Promise<void> {
  for (const client of wss.clients) {
    try {
      client.close();
    } catch {
      // Already closed — ignore.
    }
  }

  return new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    // Fallback in case the underlying server's 'close' never fires (e.g. a
    // socket that refuses to drain). Never hang the caller.
    setTimeout(finish, 1000);
    wss.close(finish);
  });
}
