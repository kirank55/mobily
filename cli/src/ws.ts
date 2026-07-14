/**
 * cli/src/ws.ts
 *
 * WebSocket + HTTP server that exposes a {@link Session} over
 * `ws://localhost:<port>`.
 *
 * The underlying `http.Server` handles both:
 *   - HTTP requests (e.g. the pairing endpoint at `/.well-known/mobily/pair`)
 *   - WebSocket upgrades (attached to the {@link Session})
 *
 * Both share the same port so the tunnel forwards them transparently.
 */

import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { WebSocketServer } from 'ws';
import type { Session } from './session.js';

export interface ServerOptions {
  /** Bind host. @default 'localhost' */
  host?: string;
  /** Bind port; `0` selects an ephemeral port. @default 0 */
  port?: number;
  /** Session that inbound WS connections attach to. */
  session: Session;
  /** Handler for non-WebSocket HTTP requests (e.g. pairing endpoint). */
  httpRequestHandler?: (req: IncomingMessage, res: ServerResponse) => void;
  /** Maximum inbound WebSocket message size. @default 65536 */
  maxPayloadBytes?: number;
  /** Maximum simultaneously connected WebSockets. @default 32 */
  maxConnections?: number;
  /** Serve HTTPS/WSS with this identity. Omit for tunnel-terminated TLS. */
  tls?: { readonly key: string; readonly cert: string };
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
 * Start a combined HTTP + WebSocket server bound to `host:port`. Resolves once
 * it is listening. WebSocket connections are attached to `options.session`;
 * HTTP requests are routed to `options.httpRequestHandler` (if provided).
 */
export function startServer(options: ServerOptions): Promise<Server> {
  const host = options.host ?? 'localhost';
  const port = options.port ?? 0;

  const requestListener = (req: IncomingMessage, res: ServerResponse): void => {
    if (options.httpRequestHandler) {
      options.httpRequestHandler(req, res);
    } else {
      res.writeHead(404).end();
    }
  };
  const httpServer = options.tls
    ? createHttpsServer({ key: options.tls.key, cert: options.tls.cert }, requestListener)
    : createServer(requestListener);

  httpServer.headersTimeout = 10_000;
  httpServer.requestTimeout = 10_000;
  const maxConnections = options.maxConnections ?? 32;
  // Keep one extra TCP slot so an over-limit WebSocket can receive close code
  // 1013; all other incomplete HTTP/TCP connections are bounded as well.
  httpServer.maxConnections = maxConnections + 1;

  const wss = new WebSocketServer({
    server: httpServer,
    maxPayload: options.maxPayloadBytes ?? 64 * 1024,
    perMessageDeflate: false,
  });
  wss.on('connection', (ws) => {
    if (wss.clients.size > maxConnections) {
      ws.close(1013, 'connection limit reached');
      return;
    }
    options.session.attach(ws);
  });

  return new Promise<Server>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      const addr = httpServer.address();
      const boundPort = typeof addr === 'object' && addr !== null ? addr.port : port;

      resolve({
        host,
        port: boundPort,
        url: `${options.tls ? 'wss' : 'ws'}://${host}:${boundPort}`,
        close: () => closeServer(httpServer, wss),
      });
    });
  });
}

/** Close the HTTP server and WebSocket server, terminating clients first. */
function closeServer(httpServer: HttpServer, wss: WebSocketServer): Promise<void> {
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
    // Fallback in case the underlying server's 'close' never fires.
    setTimeout(finish, 1000);
    wss.close(() => {
      httpServer.close(finish);
    });
  });
}
