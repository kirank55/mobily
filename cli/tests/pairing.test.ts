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
import { defaultSessionRuntime } from '../src/mux/runtime.js';

// ---------------------------------------------------------------------------
// Test runtime: uses an explicit shell path so tests are not sensitive to
// the $SHELL / COMSPEC env variables in CI runners (macOS / Windows).
// ---------------------------------------------------------------------------

const testRuntime = {
  ...defaultSessionRuntime,
  spawnPty(opts: Parameters<typeof defaultSessionRuntime.spawnPty>[0]) {
    const shell = os.platform() === 'win32' ? 'cmd.exe' : '/bin/sh';
    return defaultSessionRuntime.spawnPty({ ...opts, file: shell });
  },
};

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
  readonly frames: Record<string, unknown>[];
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
    frames,
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
  session: Session;
  deviceId: string;
  privateKeyPem: string;
}> {
  const auth = new AuthManager('test-station');
  const code = auth.generatePairingCode();
  const { publicKeyPem, privateKeyPem } = generateKeyPair();
  const deviceId = 'device-e2e';

  const session = new Session({ cols: 80, rows: 24, auth, runtime: testRuntime });
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

  return { server, auth, session, deviceId, privateKeyPem };
}

async function connectAndHandshake(
  server: Server,
  privateKeyPem: string,
  deviceId: string,
): Promise<{ ws: WebSocket; frames: Record<string, unknown>[] }> {
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

  return { ws, frames: fb.frames };
}

describe('pairing flow end-to-end', () => {
  it('pairs via HTTP, then connects via WS and streams PTY output', async () => {
    const { server, privateKeyPem, deviceId } = await setupPairedSession();

    const { ws } = await connectAndHandshake(server, privateKeyPem, deviceId);

    sendFrame(ws, { type: 'input', data: `echo E2E_OK${eol()}` });
    const out = await collectOutput(ws, (b) => b.includes('E2E_OK'));
    expect(out).toContain('E2E_OK');
  }, 20000);

  it.skipIf(os.platform() === 'win32')(
    'shares owner-selected real PTY dimensions and output, then restores Station dimensions',
    async () => {
      const { server, session, privateKeyPem, deviceId } = await setupPairedSession();
      let workstationOutput = '';
      const workstation = session.attachLocalTerminal({
        onOutput(data) {
          workstationOutput += data;
        },
      });
      workstation.resize(132, 43);

      const { ws, frames } = await connectAndHandshake(server, privateKeyPem, deviceId);
      await vi.waitFor(
        () => expect(frames.some((frame) => frame['type'] === 'session-snapshot')).toBe(true),
        { timeout: 5000 },
      );

      sendFrame(ws, { type: 'terminal-size-claim' });
      sendFrame(ws, { type: 'resize', cols: 72, rows: 21 });
      await vi.waitFor(
        () =>
          expect(
            frames.some(
              (frame) => frame['type'] === 'resize' && frame['cols'] === 72 && frame['rows'] === 21,
            ),
          ).toBe(true),
        { timeout: 5000 },
      );

      const androidOwnedOutput = collectOutput(ws, (output) =>
        output.includes('ANDROID_SIZE=21 72'),
      );
      sendFrame(ws, {
        type: 'input',
        data: `printf 'ANDROID_SIZE='; stty size${eol()}`,
      });
      expect(await androidOwnedOutput).toContain('ANDROID_SIZE=21 72');
      await vi.waitFor(() => expect(workstationOutput).toContain('ANDROID_SIZE=21 72'));

      sendFrame(ws, { type: 'terminal-size-release' });
      await vi.waitFor(
        () =>
          expect(
            frames.some(
              (frame) =>
                frame['type'] === 'resize' && frame['cols'] === 132 && frame['rows'] === 43,
            ),
          ).toBe(true),
        { timeout: 5000 },
      );

      const stationOwnedOutput = collectOutput(ws, (output) =>
        output.includes('STATION_SIZE=43 132'),
      );
      workstation.input(`printf 'STATION_SIZE='; stty size${eol()}`);
      expect(await stationOwnedOutput).toContain('STATION_SIZE=43 132');
      await vi.waitFor(() => expect(workstationOutput).toContain('STATION_SIZE=43 132'));
      workstation.dispose();
    },
    20000,
  );

  it('sends an idle bare-PTY Session Snapshot before subsequent live output', async () => {
    const { server, session, privateKeyPem, deviceId } = await setupPairedSession();
    let workstationOutput = '';
    const workstation = session.attachLocalTerminal({
      onOutput(data) {
        workstationOutput += data;
      },
    });
    workstation.input(
      `printf '\\033[?1049h\\033[2J\\033[H\\033[1;38;2;18;171;239;44m界IDLE_READY\\033[0m\\033[?25l\\033[6 q'${eol()}`,
    );
    await vi.waitFor(() => expect(workstationOutput).toContain('\u001b[?1049h'), {
      timeout: 5000,
    });
    workstation.dispose();

    const { ws, frames } = await connectAndHandshake(server, privateKeyPem, deviceId);
    await vi.waitFor(
      () => expect(frames.some((frame) => frame['type'] === 'session-snapshot')).toBe(true),
      { timeout: 5000 },
    );

    const terminalFrames = frames.filter((frame) =>
      ['auth-ok', 'terminal-size-owner', 'resize', 'session-snapshot', 'output'].includes(
        String(frame['type']),
      ),
    );
    expect(terminalFrames.slice(0, 4).map((frame) => frame['type'])).toEqual([
      'auth-ok',
      'terminal-size-owner',
      'resize',
      'session-snapshot',
    ]);
    expect(terminalFrames[1]).toMatchObject({
      owner: 'station',
      ownedByRequester: false,
    });
    const snapshot = terminalFrames[3] as {
      grid: Array<Array<{ chars: string }>>;
      cursor: { col: number; row: number; visible: boolean; style: string; blink: boolean };
      activeScreen: string;
      cols: number;
      rows: number;
    };
    expect(
      snapshot.grid
        .flat()
        .map((cell) => cell.chars)
        .join(''),
    ).toContain('IDLE_READY');
    expect(snapshot).toMatchObject({
      cols: 80,
      rows: 24,
      activeScreen: 'alternate',
      cursor: { visible: false, style: 'bar', blink: false },
    });
    expect(snapshot.grid[0]!.slice(0, 2)).toEqual([
      {
        chars: '界',
        width: 2,
        fg: { mode: 'rgb', value: 0x12abef },
        bg: { mode: 'palette', value: 4 },
        attrs: 1,
      },
      {
        chars: '',
        width: 0,
        fg: { mode: 'rgb', value: 0x12abef },
        bg: { mode: 'palette', value: 4 },
        attrs: 1,
      },
    ]);

    const echoDisabled = `ECHO_DISABLED_${Date.now()}`;
    sendFrame(ws, {
      type: 'input',
      data: `stty -echo; printf '%s' '${echoDisabled}'${eol()}`,
    });
    await collectOutput(ws, (value) => value.split(echoDisabled).length >= 3);

    const liveMarker = `LIVE_AFTER_SNAPSHOT_${Date.now()}`;
    sendFrame(ws, { type: 'input', data: `printf '%s' '${liveMarker}'${eol()}` });
    const out = await collectOutput(ws, (value) => value.includes(liveMarker));
    expect(out.split(liveMarker)).toHaveLength(2);
  }, 20000);

  it('starts one bounded ordered scrollback transfer only after snapshot paint', async () => {
    const { server, session, privateKeyPem, deviceId } = await setupPairedSession();
    let workstationOutput = '';
    const workstation = session.attachLocalTerminal({
      onOutput: (data) => {
        workstationOutput += data;
      },
    });
    const historyCommand =
      os.platform() === 'win32'
        ? 'for /L %i in (0,1,5999) do @echo HISTORY_%i'
        : 'i=0; while [ $i -lt 6000 ]; do printf \'HISTORY_%s\\n\' "$i"; i=$((i+1)); done';
    workstation.input(`${historyCommand}${eol()}`);
    await vi.waitFor(() => expect(workstationOutput).toContain('HISTORY_5999'), {
      timeout: 20_000,
    });

    const { ws, frames } = await connectAndHandshake(server, privateKeyPem, deviceId);
    await vi.waitFor(() =>
      expect(frames.some((frame) => frame['type'] === 'session-snapshot')).toBe(true),
    );
    expect(frames.some((frame) => frame['type'] === 'session-scrollback')).toBe(false);

    sendFrame(ws, { type: 'session-snapshot-applied' });
    await vi.waitFor(() =>
      expect(
        frames.some((frame) => frame['type'] === 'session-scrollback' && frame['done'] === true),
      ).toBe(true),
    );

    const snapshotIndex = frames.findIndex((frame) => frame['type'] === 'session-snapshot');
    const historyFrames = frames.filter((frame) => frame['type'] === 'session-scrollback');
    expect(frames.indexOf(historyFrames[0]!)).toBeGreaterThan(snapshotIndex);
    expect(historyFrames.map((frame) => frame['sequence'])).toEqual(
      historyFrames.map((_frame, index) => index),
    );
    expect(new Set(historyFrames.map((frame) => frame['transferId'])).size).toBe(1);
    const history = historyFrames.map((frame) => String(frame['data'])).join('');
    expect(history.length).toBeLessThanOrEqual(512 * 1024);
    expect(history).toContain('HISTORY_5999');
    workstation.dispose();
  }, 30000);

  it('HTTP pairing response includes tunnelUrl, stationName, and protocolVersion', async () => {
    const auth = new AuthManager('my-station');
    const code = auth.generatePairingCode();
    const { publicKeyPem, privateKeyPem } = generateKeyPair();

    const session = new Session({ cols: 80, rows: 24, auth, runtime: testRuntime });
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
    const session = new Session({ auth, runtime: testRuntime });
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

    const session = new Session({ cols: 80, rows: 24, auth, runtime: testRuntime });
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

    const session = new Session({ cols: 80, rows: 24, auth, runtime: testRuntime });
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

  it('adds CORS headers for plaintext local Stations used by Expo web', async () => {
    const auth = new AuthManager('test-station');
    auth.setTunnelUrl('ws://localhost:9999');
    const session = new Session({ cols: 80, rows: 24, auth, runtime: testRuntime });
    sessions.push(session);
    const server = await startServer({
      session,
      httpRequestHandler: (req, res) => auth.handleHttpRequest(req, res),
    });
    servers.push(server);

    const options = await fetch(`http://localhost:${server.port}/.well-known/mobily/pair`, {
      method: 'OPTIONS',
    });
    expect(options.status).toBe(204);
    expect(options.headers.get('access-control-allow-origin')).toBe('*');
    expect(options.headers.get('access-control-allow-methods')).toContain('POST');
  }, 10000);

  it('returns 404 for unknown paths', async () => {
    const auth = new AuthManager('test-station');
    auth.setTunnelUrl('ws://test:9999');

    const session = new Session({ cols: 80, rows: 24, auth, runtime: testRuntime });
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

    const session = new Session({ cols: 80, rows: 24, auth, runtime: testRuntime });
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
  it('replaces from a fresh snapshot before delivering buffered output exactly once', async () => {
    const { server, session, privateKeyPem, deviceId } = await setupPairedSession();
    let workstationOutput = '';
    const workstation = session.attachLocalTerminal({
      onOutput: (data) => {
        workstationOutput += data;
      },
    });

    // Client A: connect, authenticate, drive the shell.
    const { ws: a } = await connectAndHandshake(server, privateKeyPem, deviceId);
    sendFrame(a, { type: 'input', data: `echo RECONNECT_A${eol()}` });
    await collectOutput(a, (b) => b.includes('RECONNECT_A'));
    await vi.waitFor(() => expect(workstationOutput).toContain('RECONNECT_A'));

    // Disconnect A.
    a.close();
    await waitForClose(a);

    // Client B reconnects. Output produced after authentication is queued
    // behind its capture boundary and must follow the complete fresh snapshot.
    const { frames } = await connectAndHandshake(server, privateKeyPem, deviceId);
    workstationOutput = '';
    workstation.input(`printf BUFFER_ONE; printf BUFFER_TWO${eol()}`);

    await vi.waitFor(() => {
      const streamed = frames
        .filter((frame) => frame['type'] === 'output')
        .map((frame) => String(frame['data']))
        .join('');
      expect(streamed).toContain('BUFFER_ONE');
      expect(streamed).toContain('BUFFER_TWO');
      expect(streamed).toBe(workstationOutput);
    });

    const snapshotIndex = frames.findIndex((frame) => frame['type'] === 'session-snapshot');
    const firstOutputIndex = frames.findIndex((frame) => frame['type'] === 'output');
    expect(snapshotIndex).toBeGreaterThan(-1);
    expect(firstOutputIndex).toBeGreaterThan(snapshotIndex);
    const snapshot = frames[snapshotIndex] as {
      grid: Array<Array<{ chars: string }>>;
    };
    expect(
      snapshot.grid
        .flat()
        .map((cell) => cell.chars)
        .join(''),
    ).toContain('RECONNECT_A');
    workstation.dispose();
  }, 25000);
});
