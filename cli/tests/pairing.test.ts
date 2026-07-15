/**
 * cli/tests/pairing.test.ts
 *
 * End-to-end pairing flow test: HTTP pairing endpoint → WS handshake → PTY
 * streaming. Also covers the HTTP pairing endpoint error cases and reconnect
 * after disconnect.
 */

import * as os from 'node:os';
import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, type RawData } from 'ws';
import { createPairingProofPayload, PROTOCOL_VERSION } from '@mobily/shared';
import { Session } from '../src/session.js';
import { startServer, type Server } from '../src/ws.js';
import { AuthManager } from '../src/auth.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function eol(): string {
  return os.platform() === 'win32' ? '\r\n' : '\r';
}

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

function waitForClose(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => ws.once('close', () => resolve()));
}

function toText(raw: RawData): string {
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
  return Buffer.from(raw).toString('utf8');
}

function sendFrame(ws: WebSocket, frame: object): void {
  ws.send(JSON.stringify(frame));
}

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
      reject(new Error(`collectOutput timed out: ${JSON.stringify(buf)}`));
    }, timeoutMs);
    const onError = (err: Error): void => {
      cleanup();
      reject(err);
    };
    const onMessage = (raw: RawData): void => {
      try {
        const parsed = JSON.parse(toText(raw));
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
      } catch {
        // ignore
      }
    };
    ws.on('message', onMessage);
    ws.on('error', onError);
  });
}

function frameBuffer(ws: WebSocket): {
  waitFor(type: string, timeoutMs?: number): Promise<Record<string, unknown>>;
} {
  const frames: Record<string, unknown>[] = [];
  ws.on('message', (raw: RawData) => {
    try {
      frames.push(JSON.parse(toText(raw)) as Record<string, unknown>);
    } catch {
      // ignore
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
      return frames.find((f) => f['type'] === type)!;
    },
  };
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
      /* ignore */
    }
  }
  conns.length = 0;

  for (const s of servers) {
    try {
      await s.close();
    } catch {
      /* ignore */
    }
  }
  servers.length = 0;

  for (const sess of sessions) {
    try {
      sess.dispose();
    } catch {
      /* ignore */
    }
  }
  sessions.length = 0;
});

async function setupPairedSession(): Promise<{
  server: Server;
  auth: AuthManager;
  deviceId: string;
  privateKeyPem: string;
}> {
  const auth = new AuthManager('test-station');
  const code = auth.generatePairingCode();
  const { publicKeyPem, privateKeyPem } = generateKeyPair();
  const deviceId = 'device-e2e';

  const session = new Session({ cols: 80, rows: 24, auth });
  sessions.push(session);

  const server = await startServer({
    session,
    httpRequestHandler: (req, res) => auth.handleHttpRequest(req, res),
  });
  servers.push(server);

  auth.setTunnelUrl(`ws://localhost:${server.port}`);

  // Pair via HTTP.
  const proof = signNonce(
    privateKeyPem,
    createPairingProofPayload(code, deviceId, publicKeyPem, `ws://localhost:${server.port}`),
  );
  const res = await fetch(`http://localhost:${server.port}/.well-known/mobily/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, deviceId, publicKey: publicKeyPem, proof }),
  });
  expect(res.status).toBe(200);

  return { server, auth, deviceId, privateKeyPem };
}

async function connectAndHandshake(
  server: Server,
  privateKeyPem: string,
  deviceId: string,
): Promise<WebSocket> {
  const ws = new WebSocket(server.url);
  await waitForOpen(ws);
  conns.push(ws);

  const fb = frameBuffer(ws);
  sendFrame(ws, { type: 'hello', protocolVersion: PROTOCOL_VERSION });
  await fb.waitFor('hello-ack');
  const challenge = await fb.waitFor('auth-challenge');

  const signature = signNonce(privateKeyPem, challenge['nonce'] as string);
  sendFrame(ws, { type: 'auth-response', deviceId, signature });
  await fb.waitFor('auth-ok');

  return ws;
}

describe('pairing flow end-to-end', () => {
  it('pairs via HTTP, then connects via WS and streams PTY output', async () => {
    const { server, privateKeyPem, deviceId } = await setupPairedSession();

    const ws = await connectAndHandshake(server, privateKeyPem, deviceId);

    sendFrame(ws, { type: 'input', data: `echo E2E_OK${eol()}` });
    const out = await collectOutput(ws, (b) => b.includes('E2E_OK'));
    expect(out).toContain('E2E_OK');
  }, 20000);

  it('HTTP pairing response includes tunnelUrl, stationName, and protocolVersion', async () => {
    const auth = new AuthManager('my-station');
    const code = auth.generatePairingCode();
    const { publicKeyPem, privateKeyPem } = generateKeyPair();

    const session = new Session({ cols: 80, rows: 24, auth });
    sessions.push(session);
    const server = await startServer({
      session,
      httpRequestHandler: (req, res) => auth.handleHttpRequest(req, res),
    });
    servers.push(server);
    auth.setTunnelUrl(`ws://localhost:${server.port}`);

    const proof = signNonce(
      privateKeyPem,
      createPairingProofPayload(code, 'dev1', publicKeyPem, `ws://localhost:${server.port}`),
    );
    const res = await fetch(`http://localhost:${server.port}/.well-known/mobily/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, deviceId: 'dev1', publicKey: publicKeyPem, proof }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['tunnelUrl']).toBe(`ws://localhost:${server.port}`);
    expect(body['stationName']).toBe('my-station');
    expect(body['protocolVersion']).toBe(PROTOCOL_VERSION);
  }, 15000);
});

describe('pairing endpoint error cases', () => {
  it.each([
    ['null body', 'null'],
    ['array body', '[]'],
    [
      'non-string field',
      JSON.stringify({ code: {}, deviceId: 'dev1', publicKey: 'x', proof: 'x' }),
    ],
  ])('returns 400 for %s without terminating the Station', async (_name, body) => {
    const auth = new AuthManager('test-station');
    auth.setTunnelUrl('ws://test:9999');
    auth.generatePairingCode();
    const session = new Session({ auth });
    sessions.push(session);
    const server = await startServer({
      session,
      httpRequestHandler: (req, res) => auth.handleHttpRequest(req, res),
    });
    servers.push(server);

    const url = `http://localhost:${server.port}/.well-known/mobily/pair`;
    const invalid = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    expect(invalid.status).toBe(400);

    const followUp = await fetch(`http://localhost:${server.port}/unknown`);
    expect(followUp.status).toBe(404);
  });

  it('returns 403 for an invalid pairing code', async () => {
    const auth = new AuthManager('test-station');
    auth.setTunnelUrl('ws://test:9999');
    auth.generatePairingCode();
    const { publicKeyPem } = generateKeyPair();

    const session = new Session({ cols: 80, rows: 24, auth });
    sessions.push(session);
    const server = await startServer({
      session,
      httpRequestHandler: (req, res) => auth.handleHttpRequest(req, res),
    });
    servers.push(server);

    const res = await fetch(`http://localhost:${server.port}/.well-known/mobily/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'WRONG',
        deviceId: 'dev1',
        publicKey: publicKeyPem,
        proof: 'invalid',
      }),
    });

    expect(res.status).toBe(403);
  }, 10000);

  it('returns 400 for missing fields', async () => {
    const auth = new AuthManager('test-station');
    auth.setTunnelUrl('ws://test:9999');
    auth.generatePairingCode();

    const session = new Session({ cols: 80, rows: 24, auth });
    sessions.push(session);
    const server = await startServer({
      session,
      httpRequestHandler: (req, res) => auth.handleHttpRequest(req, res),
    });
    servers.push(server);

    const res = await fetch(`http://localhost:${server.port}/.well-known/mobily/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '', deviceId: '', publicKey: '', proof: '' }),
    });

    expect(res.status).toBe(400);
  }, 10000);

  it('returns 404 for unknown paths', async () => {
    const auth = new AuthManager('test-station');
    auth.setTunnelUrl('ws://test:9999');

    const session = new Session({ cols: 80, rows: 24, auth });
    sessions.push(session);
    const server = await startServer({
      session,
      httpRequestHandler: (req, res) => auth.handleHttpRequest(req, res),
    });
    servers.push(server);

    const res = await fetch(`http://localhost:${server.port}/unknown`);

    expect(res.status).toBe(404);
  }, 10000);

  it('returns 400 for invalid JSON', async () => {
    const auth = new AuthManager('test-station');
    auth.setTunnelUrl('ws://test:9999');

    const session = new Session({ cols: 80, rows: 24, auth });
    sessions.push(session);
    const server = await startServer({
      session,
      httpRequestHandler: (req, res) => auth.handleHttpRequest(req, res),
    });
    servers.push(server);

    const res = await fetch(`http://localhost:${server.port}/.well-known/mobily/pair`, {
      method: 'POST',
      body: 'not-json',
    });

    expect(res.status).toBe(400);
  }, 10000);
});

describe('reconnect after disconnect', () => {
  it('a second WS connection with the same device succeeds and the PTY is still alive', async () => {
    const { server, privateKeyPem, deviceId } = await setupPairedSession();

    // Client A: connect, authenticate, drive the shell.
    const a = await connectAndHandshake(server, privateKeyPem, deviceId);
    sendFrame(a, { type: 'input', data: `echo RECONNECT_A${eol()}` });
    await collectOutput(a, (b) => b.includes('RECONNECT_A'));

    // Disconnect A.
    a.close();
    await waitForClose(a);

    // Client B: reconnect with the same device.
    const b = await connectAndHandshake(server, privateKeyPem, deviceId);
    sendFrame(b, { type: 'input', data: `echo RECONNECT_B${eol()}` });
    const out = await collectOutput(b, (b2) => b2.includes('RECONNECT_B'));
    expect(out).toContain('RECONNECT_B');
  }, 25000);
});
