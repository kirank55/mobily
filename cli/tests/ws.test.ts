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
import { generateKeyPairSync, sign } from 'node:crypto';
import { Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, type RawData } from 'ws';
import { createPairingProofPayload, PROTOCOL_VERSION, WS_CLOSE_CODES } from '@mobily/shared';
import { Session } from '../src/session.js';
import { startServer, type Server } from '../src/ws.js';
import { AuthManager } from '../src/auth.js';
import type { SessionBackend } from '../src/mux/types.js';
import type { IDisposable } from '../src/pty/node-pty.js';

class RecordingBackend implements SessionBackend {
  readonly kind = 'bare' as const;
  readonly sessionName = null;
  readonly attachCommand = null;
  readonly writes: string[] = [];
  readonly resizes: Array<[number, number]> = [];
  readonly dataListeners = new Set<(data: string) => void>();

  constructor(private readonly replay = '') {}

  write(data: string): void {
    this.writes.push(data);
  }
  resize(cols: number, rows: number): void {
    this.resizes.push([cols, rows]);
  }
  onData(listener: (data: string) => void): IDisposable {
    this.dataListeners.add(listener);
    return { dispose: () => this.dataListeners.delete(listener) };
  }
  onExit(): IDisposable {
    return { dispose() {} };
  }
  readScrollback(): string {
    return this.replay;
  }
  dispose(): void {}
  emit(data: string): void {
    for (const listener of this.dataListeners) listener(data);
  }
}

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
    const timer = setTimeout(() => reject(new Error('ws open timed out')), timeoutMs);
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

function waitForCloseCode(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => ws.once('close', (code) => resolve(code)));
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
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        typeof (parsed as { data?: unknown }).data === 'string'
      ) {
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
const rawSockets: Socket[] = [];

afterEach(async () => {
  for (const ws of conns) {
    try {
      ws.close();
    } catch {
      // ignore
    }
  }
  conns.length = 0;

  for (const socket of rawSockets) socket.destroy();
  rawSockets.length = 0;

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
  it('echoes input through the PTY and back as output frames', async () => {
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
  }, 15000);

  it('correlates tagged input with the next PTY output sent to that client', async () => {
    const session = new Session({ cols: 80, rows: 24 });
    sessions.push(session);
    const server = await startServer({ session });
    servers.push(server);

    const ws = new WebSocket(server.url);
    await waitForOpen(ws);
    conns.push(ws);

    const taggedOutput = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('tagged output timed out')), 10_000);
      ws.on('message', (raw: RawData) => {
        const frame = JSON.parse(toText(raw)) as Record<string, unknown>;
        if (
          frame['type'] === 'output' &&
          Array.isArray(frame['latencyTags']) &&
          frame['latencyTags'].includes('latency-1234')
        ) {
          clearTimeout(timer);
          resolve(frame);
        }
      });
    });

    sendFrame(ws, {
      type: 'input',
      data: `echo LATENCY_TEST${eol()}`,
      latencyTag: 'latency-1234',
    });

    await expect(taggedOutput).resolves.toMatchObject({
      type: 'output',
      latencyTags: ['latency-1234'],
    });
  }, 15000);

  it('applies resize frames to the PTY', async () => {
    const backend = new RecordingBackend();
    const session = new Session({ backend });
    sessions.push(session);
    const server = await startServer({ session });
    servers.push(server);

    const ws = new WebSocket(server.url);
    await waitForOpen(ws);
    conns.push(ws);

    sendFrame(ws, { type: 'resize', cols: 120, rows: 36 });

    await vi.waitFor(
      () => {
        expect(backend.resizes).toContainEqual([120, 36]);
      },
      { timeout: 5000, interval: 50 },
    );
  }, 15000);

  it('replies with an error output frame for malformed input', async () => {
    const session = new Session({ cols: 80, rows: 24 });
    sessions.push(session);
    const server = await startServer({ session });
    servers.push(server);

    const ws = new WebSocket(server.url);
    await waitForOpen(ws);
    conns.push(ws);

    const closeCode = waitForCloseCode(ws);
    ws.send('not-json-SENSITIVE_CONTENT');

    const out = await collectOutput(ws, (b) => b.includes('mobily:'));
    expect(out).toContain('mobily:');
    expect(out).toContain('malformed frame');
    expect(out).not.toContain('SENSITIVE_CONTENT');
    expect(await closeCode).toBe(WS_CLOSE_CODES.MALFORMED_FRAME);
  }, 15000);
});

describe('session survives client disconnect', () => {
  it('keeps the PTY alive so a second client can reattach and drive it', async () => {
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
  }, 20000);
});

// ---------------------------------------------------------------------------
// Handshake tests: hello → hello-ack → auth-challenge → auth-response
// ---------------------------------------------------------------------------

function generateKeyPair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString('utf8'),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString('utf8'),
  };
}

function signNonce(privateKeyPem: string, nonce: string): string {
  return sign('SHA256', Buffer.from(nonce), privateKeyPem).toString('base64');
}

function pairDevice(
  auth: AuthManager,
  code: string,
  deviceId: string,
  publicKeyPem: string,
  privateKeyPem: string,
): void {
  const proof = signNonce(
    privateKeyPem,
    createPairingProofPayload(code, deviceId, publicKeyPem, 'ws://test:9999'),
  );
  expect(auth.pair(code, deviceId, publicKeyPem, proof).ok).toBe(true);
}

/** Collect frames of a specific type. Buffers all messages to avoid races. */
function frameBuffer(ws: WebSocket): {
  waitFor(type: string, timeoutMs?: number): Promise<Record<string, unknown>>;
  getNonce(): string;
} {
  const frames: Record<string, unknown>[] = [];
  ws.on('message', (raw: RawData) => {
    try {
      frames.push(JSON.parse(toText(raw)) as Record<string, unknown>);
    } catch {
      // ignore non-JSON
    }
  });

  return {
    async waitFor(type: string, timeoutMs = 5000): Promise<Record<string, unknown>> {
      await vi.waitFor(
        () => {
          expect(frames.some((f) => f['type'] === type)).toBe(true);
        },
        { timeout: timeoutMs, interval: 50 },
      );
      const frame = frames.find((f) => f['type'] === type)!;
      return frame;
    },
    getNonce(): string {
      const challenge = frames.find((f) => f['type'] === 'auth-challenge');
      return challenge?.['nonce'] as string;
    },
  };
}

describe('handshake: version negotiation + auth', () => {
  it('replays backend scrollback after authentication before live output', async () => {
    const auth = new AuthManager('test-station');
    auth.setTunnelUrl('ws://test:9999');
    const code = auth.generatePairingCode();
    const { publicKeyPem, privateKeyPem } = generateKeyPair();
    pairDevice(auth, code, 'device-1', publicKeyPem, privateKeyPem);
    const backend = new RecordingBackend('previous command\r\nprevious output\r\n');
    const session = new Session({ backend, auth });
    sessions.push(session);
    const server = await startServer({ session });
    servers.push(server);
    const ws = new WebSocket(server.url);
    const received: Record<string, unknown>[] = [];
    ws.on('message', (raw: RawData) => {
      received.push(JSON.parse(toText(raw)) as Record<string, unknown>);
    });
    await waitForOpen(ws);
    conns.push(ws);

    sendFrame(ws, { type: 'hello', protocolVersion: PROTOCOL_VERSION });
    await vi.waitFor(() => expect(received.some((frame) => frame['type'] === 'auth-challenge')).toBe(true));
    const nonce = received.find((frame) => frame['type'] === 'auth-challenge')!['nonce'] as string;
    sendFrame(ws, {
      type: 'auth-response',
      deviceId: 'device-1',
      signature: signNonce(privateKeyPem, nonce),
    });
    await vi.waitFor(() =>
      expect(received.some((frame) => frame['type'] === 'output')).toBe(true),
    );
    backend.emit('live output\r\n');
    await vi.waitFor(() =>
      expect(received.filter((frame) => frame['type'] === 'output')).toHaveLength(2),
    );

    const terminalFrames = received.filter((frame) => frame['type'] === 'output');
    expect(terminalFrames.map((frame) => frame['data'])).toEqual([
      'previous command\r\nprevious output\r\n',
      'live output\r\n',
    ]);
  });

  it('broadcasts detected terminal prompts as alert frames', async () => {
    const backend = new RecordingBackend();
    const session = new Session({ backend });
    sessions.push(session);
    const server = await startServer({ session });
    servers.push(server);
    const ws = new WebSocket(server.url);
    await waitForOpen(ws);
    conns.push(ws);
    const alerts: Record<string, unknown>[] = [];
    ws.on('message', (raw: RawData) => {
      const frame = JSON.parse(toText(raw)) as Record<string, unknown>;
      if (frame['type'] === 'alert') alerts.push(frame);
    });

    backend.emit('\x1b[33mApprove deployment?\x1b[0m\r\n');

    await vi.waitFor(() => expect(alerts).toEqual([
      { type: 'alert', message: 'Approve deployment?' },
    ]));
  });

  it('completes the full handshake and streams PTY output', async () => {
    const auth = new AuthManager('test-station');
    auth.setTunnelUrl('ws://test:9999');
    const code = auth.generatePairingCode();
    const { publicKeyPem, privateKeyPem } = generateKeyPair();
    pairDevice(auth, code, 'device-1', publicKeyPem, privateKeyPem);

    const session = new Session({ cols: 80, rows: 24, auth });
    sessions.push(session);
    const server = await startServer({ session });
    servers.push(server);

    const ws = new WebSocket(server.url);
    await waitForOpen(ws);
    conns.push(ws);

    const fb = frameBuffer(ws);

    // Step 1: send hello
    sendFrame(ws, { type: 'hello', protocolVersion: PROTOCOL_VERSION });

    // Step 2: expect hello-ack + auth-challenge
    const ack = await fb.waitFor('hello-ack');
    expect(ack['protocolVersion']).toBe(PROTOCOL_VERSION);

    const challenge = await fb.waitFor('auth-challenge');
    const nonce = challenge['nonce'] as string;
    expect(nonce).toBeTruthy();

    // Step 3: sign and send auth-response
    const signature = signNonce(privateKeyPem, nonce);
    sendFrame(ws, { type: 'auth-response', deviceId: 'device-1', signature });

    await fb.waitFor('auth-ok');

    // Step 4: verify PTY output streams
    sendFrame(ws, { type: 'input', data: `echo HANDSHAKE_OK${eol()}` });
    const out = await collectOutput(ws, (b) => b.includes('HANDSHAKE_OK'));
    expect(out).toContain('HANDSHAKE_OK');
  }, 20000);

  it('rejects version mismatch and closes the connection', async () => {
    const auth = new AuthManager('test-station');
    auth.setTunnelUrl('ws://test:9999');
    const code = auth.generatePairingCode();
    const { publicKeyPem, privateKeyPem } = generateKeyPair();
    pairDevice(auth, code, 'device-1', publicKeyPem, privateKeyPem);

    const session = new Session({ cols: 80, rows: 24, auth });
    sessions.push(session);
    const server = await startServer({ session });
    servers.push(server);

    const ws = new WebSocket(server.url);
    await waitForOpen(ws);
    conns.push(ws);

    sendFrame(ws, { type: 'hello', protocolVersion: 999 });

    const out = await collectOutput(ws, (b) => b.includes('version mismatch'));
    expect(out).toContain('version mismatch');

    const closeCode = await waitForCloseCode(ws);
    expect(ws.readyState).toBe(WebSocket.CLOSED);
    expect(closeCode).toBe(WS_CLOSE_CODES.VERSION_MISMATCH);
  }, 15000);

  it('rejects invalid auth signature and closes the connection', async () => {
    const auth = new AuthManager('test-station');
    auth.setTunnelUrl('ws://test:9999');
    const code = auth.generatePairingCode();
    const { publicKeyPem, privateKeyPem } = generateKeyPair();
    pairDevice(auth, code, 'device-1', publicKeyPem, privateKeyPem);

    const session = new Session({ cols: 80, rows: 24, auth });
    sessions.push(session);
    const server = await startServer({ session });
    servers.push(server);

    const ws = new WebSocket(server.url);
    await waitForOpen(ws);
    conns.push(ws);

    const fb = frameBuffer(ws);

    sendFrame(ws, { type: 'hello', protocolVersion: PROTOCOL_VERSION });
    await fb.waitFor('hello-ack');
    await fb.waitFor('auth-challenge');

    sendFrame(ws, {
      type: 'auth-response',
      deviceId: 'device-1',
      signature: Buffer.from('fake-signature').toString('base64'),
    });

    const out = await collectOutput(ws, (b) => b.includes('authentication failed'));
    expect(out).toContain('authentication failed');

    await waitForClose(ws);
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  }, 15000);

  it('rejects unbound device and closes the connection', async () => {
    const auth = new AuthManager('test-station');
    auth.setTunnelUrl('ws://test:9999');

    const session = new Session({ cols: 80, rows: 24, auth });
    sessions.push(session);
    const server = await startServer({ session });
    servers.push(server);

    const ws = new WebSocket(server.url);
    await waitForOpen(ws);
    conns.push(ws);

    const fb = frameBuffer(ws);

    sendFrame(ws, { type: 'hello', protocolVersion: PROTOCOL_VERSION });
    await fb.waitFor('hello-ack');
    const challenge = await fb.waitFor('auth-challenge');
    const nonce = challenge['nonce'] as string;

    const { privateKeyPem } = generateKeyPair();
    const signature = signNonce(privateKeyPem, nonce);
    sendFrame(ws, {
      type: 'auth-response',
      deviceId: 'unknown-device',
      signature,
    });

    const out = await collectOutput(ws, (b) => b.includes('authentication failed'));
    expect(out).toContain('authentication failed');

    await waitForClose(ws);
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  }, 15000);

  it('expires a connection that does not complete the handshake', async () => {
    const auth = new AuthManager('test-station');
    auth.setTunnelUrl('wss://test.example:9999');
    const session = new Session({ auth, handshakeTimeoutMs: 50 });
    sessions.push(session);
    const server = await startServer({ session });
    servers.push(server);

    const ws = new WebSocket(server.url);
    await waitForOpen(ws);
    conns.push(ws);

    expect(await waitForCloseCode(ws)).toBe(WS_CLOSE_CODES.HANDSHAKE_TIMEOUT);
  }, 5000);
});

describe('anonymous connection limits', () => {
  it('rejects frames larger than the protocol payload limit', async () => {
    const session = new Session();
    sessions.push(session);
    const server = await startServer({ session, maxPayloadBytes: 1024 });
    servers.push(server);
    const ws = new WebSocket(server.url);
    await waitForOpen(ws);
    conns.push(ws);

    ws.send('x'.repeat(1025));
    expect(await waitForCloseCode(ws)).toBe(1009);
  });

  it('rejects connections above the global cap', async () => {
    const session = new Session();
    sessions.push(session);
    const server = await startServer({ session, maxConnections: 1 });
    servers.push(server);

    const first = new WebSocket(server.url);
    await waitForOpen(first);
    conns.push(first);

    const second = new WebSocket(server.url);
    const secondClosed = waitForCloseCode(second);
    await waitForOpen(second);
    conns.push(second);
    expect(await secondClosed).toBe(1013);
  });

  it('bounds incomplete TCP/HTTP connections before WebSocket upgrade', async () => {
    const session = new Session();
    sessions.push(session);
    const server = await startServer({ session, maxConnections: 1 });
    servers.push(server);

    const connectRaw = (): Promise<Socket> =>
      new Promise((resolve, reject) => {
        const socket = new Socket();
        rawSockets.push(socket);
        socket.once('error', reject);
        socket.connect(server.port, server.host, () => {
          socket.off('error', reject);
          resolve(socket);
        });
      });

    await connectRaw();
    await connectRaw();

    const overLimit = new Socket();
    rawSockets.push(overLimit);
    const closed = new Promise<void>((resolve) => overLimit.once('close', () => resolve()));
    overLimit.on('error', () => {});
    overLimit.connect(server.port, server.host);

    await closed;
    expect(overLimit.destroyed).toBe(true);
  });
});
