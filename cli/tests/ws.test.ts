/**
 * cli/tests/ws.test.ts
 *
 * Integration test: WebSocket client → PTY round-trip through the Session.
 *
 * Spawns a real PTY, starts a real `ws` server on an ephemeral port, connects a
 * real `ws` client, and asserts that `input` frames drive the shell and
 * `output` frames come back. Also verifies the session survives a client
 * disconnect (the Phase 1 bare-PTY invariant) and that `resize` frames
 * propagate to the PTY.
 */

import * as os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, type RawData } from 'ws';
import { Session } from '../src/session.js';
import { startServer, type Server } from '../src/ws.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Platform-appropriate newline that the default shell will execute. */
function eol(): string {
  return os.platform() === 'win32' ? '\r\n' : '\r';
}

/** Resolve once the client socket is open, or reject on error/timeout. */
function waitForOpen(ws: WebSocket, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === 1) {
      resolve();
      return;
    }
    const timer = setTimeout(
      () => reject(new Error('ws open timed out')),
      timeoutMs,
    );
    const onError = (err: Error): void => {
      clearTimeout(timer);
      reject(err);
    };
    ws.once('open', () => {
      clearTimeout(timer);
      ws.off('error', onError);
      resolve();
    });
    ws.once('error', onError);
  });
}

/** Resolve once the socket emits `close`. */
function waitForClose(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => ws.once('close', () => resolve()));
}

/** Convert a `ws` inbound message to a UTF-8 string. */
function toText(raw: RawData): string {
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
  return Buffer.from(raw).toString('utf8');
}

/**
 * Accumulate the `data` field of received `output` frames until `predicate`
 * returns true, then resolve with the full buffer.
 */
function collectOutput(
  ws: WebSocket,
  predicate: (acc: string) => boolean,
  timeoutMs = 10000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const cleanup = (): void => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('error', onError);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`collectOutput timed out after ${timeoutMs}ms: ${JSON.stringify(buf)}`));
    }, timeoutMs);
    const onError = (err: Error): void => {
      cleanup();
      reject(err);
    };
    const onMessage = (raw: RawData): void => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(toText(raw));
      } catch {
        return;
      }
      if (parsed !== null && typeof parsed === 'object' &&
        typeof (parsed as { data?: unknown }).data === 'string') {
        buf += (parsed as { data: string }).data;
        if (predicate(buf)) {
          cleanup();
          resolve(buf);
        }
      }
    };
    ws.on('message', onMessage);
    ws.on('error', onError);
  });
}

/** Send a frame object as a JSON string. */
function sendFrame(ws: WebSocket, frame: object): void {
  ws.send(JSON.stringify(frame));
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

const sessions: Session[] = [];
const servers: Server[] = [];
const conns: WebSocket[] = [];

afterEach(async () => {
  for (const ws of conns) {
    try {
      ws.close();
    } catch {
      // ignore
    }
  }
  conns.length = 0;

  for (const s of servers) {
    try {
      await s.close();
    } catch {
      // ignore
    }
  }
  servers.length = 0;

  for (const sess of sessions) {
    try {
      sess.dispose();
    } catch {
      // ignore
    }
  }
  sessions.length = 0;
});

describe('WebSocket → PTY round-trip', () => {
  it(
    'echoes input through the PTY and back as output frames',
    async () => {
      const session = new Session({ cols: 80, rows: 24 });
      sessions.push(session);
      const server = await startServer({ session });
      servers.push(server);

      const ws = new WebSocket(server.url);
      await waitForOpen(ws);
      conns.push(ws);

      sendFrame(ws, { type: 'input', data: `echo MOBILY_TEST${eol()}` });

      const out = await collectOutput(ws, (b) => b.includes('MOBILY_TEST'));
      expect(out).toContain('MOBILY_TEST');
    },
    15000,
  );

  it(
    'applies resize frames to the PTY',
    async () => {
      const session = new Session({ cols: 80, rows: 24 });
      sessions.push(session);
      const server = await startServer({ session });
      servers.push(server);

      const ws = new WebSocket(server.url);
      await waitForOpen(ws);
      conns.push(ws);

      sendFrame(ws, { type: 'resize', cols: 120, rows: 36 });

      await vi.waitFor(
        () => {
          expect(session.pty.raw.cols).toBe(120);
          expect(session.pty.raw.rows).toBe(36);
        },
        { timeout: 5000, interval: 50 },
      );
    },
    15000,
  );

  it(
    'replies with an error output frame for malformed input',
    async () => {
      const session = new Session({ cols: 80, rows: 24 });
      sessions.push(session);
      const server = await startServer({ session });
      servers.push(server);

      const ws = new WebSocket(server.url);
      await waitForOpen(ws);
      conns.push(ws);

      ws.send('not-json');

      const out = await collectOutput(ws, (b) => b.includes('mobily:'));
      expect(out).toContain('mobily:');
      expect(out).toContain('malformed frame');
    },
    15000,
  );
});

describe('session survives client disconnect', () => {
  it(
    'keeps the PTY alive so a second client can reattach and drive it',
    async () => {
      const session = new Session({ cols: 80, rows: 24 });
      sessions.push(session);
      const server = await startServer({ session });
      servers.push(server);

      // Client A: drive the shell, then disconnect.
      const a = new WebSocket(server.url);
      await waitForOpen(a);
      sendFrame(a, { type: 'input', data: `echo MARKER_A${eol()}` });
      await collectOutput(a, (b) => b.includes('MARKER_A'));
      a.close();
      await waitForClose(a);

      // The session must NOT have died with the client.
      expect(session.closed).toBe(false);

      // Client B: reattach to the same live PTY and drive it.
      const b = new WebSocket(server.url);
      await waitForOpen(b);
      conns.push(b);
      sendFrame(b, { type: 'input', data: `echo MARKER_B${eol()}` });

      const out = await collectOutput(b, (x) => x.includes('MARKER_B'));
      expect(out).toContain('MARKER_B');
      expect(session.closed).toBe(false);
    },
    20000,
  );
});
