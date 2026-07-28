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
import { MemoryBindingRepository } from '../src/bindings.js';
import type { SessionBackend } from '../src/sessionBackend/types.js';
import type { IDisposable } from '../src/pty.js';

class RecordingBackend implements SessionBackend {
  readonly kind = 'bare' as const;
  readonly sessionName = null;
  readonly attachCommand = null;
  readonly writes: string[] = [];
  readonly resizes: Array<[number, number]> = [];
  readonly dataListeners = new Set<(data: string) => void>();
  readonly exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>();

  constructor(
    private readonly replay = '',
    private readonly onVisibleScreenCapture: () => void = () => undefined,
  ) {}

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
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): IDisposable {
    this.exitListeners.add(listener);
    return { dispose: () => this.exitListeners.delete(listener) };
  }
  readScrollback(): string {
    return this.replay;
  }
  captureVisibleScreen(): string {
    this.onVisibleScreenCapture();
    return this.replay;
  }
  dispose(): void {}
  emit(data: string): void {
    for (const listener of this.dataListeners) listener(data);
  }
  emitExit(event: { exitCode: number; signal?: number }): void {
    for (const listener of this.exitListeners) listener(event);
  }
}

class FailingRestoreBackend extends RecordingBackend {
  failNextResize = false;

  override resize(cols: number, rows: number): void {
    if (this.failNextResize) {
      this.failNextResize = false;
      throw new Error(`resize unavailable at ${cols}x${rows}`);
    }
    super.resize(cols, rows);
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

  it('applies resize frames to the PTY after an explicit size claim', async () => {
    const backend = new RecordingBackend();
    const session = new Session({ backend });
    const authenticated = vi.fn();
    session.onAuthenticatedClient(authenticated);
    sessions.push(session);
    const server = await startServer({ session });
    servers.push(server);

    const ws = new WebSocket(server.url);
    const initialResize = new Promise<Record<string, unknown>>((resolve) => {
      ws.on('message', (raw: RawData) => {
        const frame = JSON.parse(toText(raw)) as Record<string, unknown>;
        if (frame['type'] === 'resize') resolve(frame);
      });
    });
    await waitForOpen(ws);
    conns.push(ws);
    await vi.waitFor(() => expect(authenticated).toHaveBeenCalledOnce());
    await expect(initialResize).resolves.toEqual({ type: 'resize', cols: 120, rows: 40 });

    sendFrame(ws, { type: 'terminal-size-claim' });
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

describe('local workstation terminal attachment', () => {
  it('replays and streams exact PTY output while forwarding input and resize', () => {
    const backend = new RecordingBackend('\u001b[31mexisting\u001b[0m\r\n');
    const session = new Session({ backend });
    sessions.push(session);
    const output: string[] = [];

    const terminal = session.attachLocalTerminal({
      onOutput: (data) => output.push(data),
    });

    expect(output).toEqual(['\u001b[31mexisting\u001b[0m\r\n']);

    terminal.input('hidden input');
    terminal.resize(132, 43);

    expect(backend.writes).toEqual(['hidden input']);
    expect(backend.resizes).toEqual([[132, 43]]);
    expect(output).toEqual(['\u001b[31mexisting\u001b[0m\r\n']);

    backend.emit('\u001b[2Kvisible result\r\n');
    expect(output).toEqual(['\u001b[31mexisting\u001b[0m\r\n', '\u001b[2Kvisible result\r\n']);

    terminal.dispose();
    backend.emit('after dispose');
    expect(output).not.toContain('after dispose');
  });

  it('notifies the workstation when the shared session exits', () => {
    const backend = new RecordingBackend();
    const session = new Session({ backend });
    sessions.push(session);
    const exits: Array<{ exitCode: number; signal?: number }> = [];
    const sessionExits: Array<{ exitCode: number; signal?: number }> = [];

    session.attachLocalTerminal({
      onOutput() {},
      onExit: (event) => exits.push(event),
    });
    session.onExit((event) => sessionExits.push(event));
    backend.emitExit({ exitCode: 7, signal: 15 });

    expect(exits).toEqual([{ exitCode: 7, signal: 15 }]);
    expect(sessionExits).toEqual([{ exitCode: 7, signal: 15 }]);
    expect(session.closed).toBe(true);
  });

  it('isolates failing exit observers so every client still receives cleanup', () => {
    const backend = new RecordingBackend();
    const session = new Session({ backend });
    sessions.push(session);
    const delivered: string[] = [];

    session.attachLocalTerminal({
      onOutput() {},
      onExit: () => {
        throw new Error('local observer failed');
      },
    });
    session.onExit(() => {
      throw new Error('first observer failed');
    });
    session.onExit(() => delivered.push('second observer'));

    expect(() => backend.emitExit({ exitCode: 0 })).not.toThrow();
    expect(delivered).toEqual(['second observer']);
  });

  it('keeps workstation dimensions authoritative over remote resize frames', async () => {
    const backend = new RecordingBackend();
    const session = new Session({ backend });
    sessions.push(session);
    const terminal = session.attachLocalTerminal({ onOutput() {} });
    terminal.resize(160, 48);

    const server = await startServer({ session });
    servers.push(server);
    const ws = new WebSocket(server.url);
    await waitForOpen(ws);
    conns.push(ws);

    sendFrame(ws, { type: 'resize', cols: 60, rows: 20 });
    sendFrame(ws, { type: 'input', data: 'processed-after-resize' });
    await vi.waitFor(() => expect(backend.writes).toContain('processed-after-resize'));

    expect(backend.resizes).toEqual([[160, 48]]);
  });

  it('transfers size ownership to Android and restores Station dimensions on release', async () => {
    const backend = new RecordingBackend();
    const session = new Session({ backend, ownershipLeaseMs: 10_000 });
    sessions.push(session);
    const workstation = session.attachLocalTerminal({ onOutput() {} });
    workstation.resize(160, 48);
    const server = await startServer({ session });
    servers.push(server);
    const ws = new WebSocket(server.url);
    const frames = frameBuffer(ws);
    await waitForOpen(ws);
    conns.push(ws);
    await frames.waitFor('session-snapshot');

    sendFrame(ws, { type: 'resize', cols: 60, rows: 20 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(backend.resizes.at(-1)).toEqual([160, 48]);

    sendFrame(ws, { type: 'terminal-size-claim' });
    expect(
      await frames.waitForMatch(
        'terminal-size-owner',
        (frame) => frame['owner'] === 'android' && frame['ownedByRequester'] === true,
      ),
    ).toMatchObject({
      owner: 'android',
      ownedByRequester: true,
    });
    sendFrame(ws, { type: 'resize', cols: 60, rows: 20 });
    await vi.waitFor(() => expect(backend.resizes.at(-1)).toEqual([60, 20]));

    sendFrame(ws, { type: 'terminal-size-release' });
    await vi.waitFor(() => expect(backend.resizes.at(-1)).toEqual([160, 48]));
    workstation.dispose();
  });

  it('arbitrates multiple viewers and falls back through valid claimants to the Station', async () => {
    const backend = new RecordingBackend();
    const session = new Session({ backend, ownershipLeaseMs: 600 });
    sessions.push(session);
    const workstation = session.attachLocalTerminal({ onOutput() {} });
    workstation.resize(160, 48);
    const server = await startServer({ session });
    servers.push(server);

    const first = new WebSocket(server.url);
    const firstFrames = frameBuffer(first);
    const second = new WebSocket(server.url);
    const secondFrames = frameBuffer(second);
    await Promise.all([waitForOpen(first), waitForOpen(second)]);
    conns.push(first, second);
    await Promise.all([
      firstFrames.waitFor('session-snapshot'),
      secondFrames.waitFor('session-snapshot'),
    ]);

    sendFrame(first, { type: 'terminal-size-claim' });
    await firstFrames.waitForMatch(
      'terminal-size-owner',
      (frame) => frame['owner'] === 'android' && frame['ownedByRequester'] === true,
    );
    sendFrame(first, { type: 'resize', cols: 90, rows: 30 });
    await vi.waitFor(() => expect(backend.resizes.at(-1)).toEqual([90, 30]));

    sendFrame(second, { type: 'terminal-size-claim' });
    await Promise.all([
      firstFrames.waitForMatch(
        'terminal-size-owner',
        (frame) => frame['owner'] === 'android' && frame['ownedByRequester'] === false,
      ),
      secondFrames.waitForMatch(
        'terminal-size-owner',
        (frame) => frame['owner'] === 'android' && frame['ownedByRequester'] === true,
      ),
    ]);

    sendFrame(first, { type: 'resize', cols: 70, rows: 20 });
    sendFrame(first, { type: 'input', data: 'first remains interactive' });
    sendFrame(second, { type: 'input', data: 'second remains interactive' });
    await vi.waitFor(() =>
      expect(backend.writes).toEqual(
        expect.arrayContaining(['first remains interactive', 'second remains interactive']),
      ),
    );
    expect(backend.resizes.at(-1)).toEqual([90, 30]);

    sendFrame(second, { type: 'resize', cols: 80, rows: 25 });
    await vi.waitFor(() => expect(backend.resizes.at(-1)).toEqual([80, 25]));

    const firstOwnerFramesBeforeRelease = firstFrames.frames.filter(
      (frame) =>
        frame['type'] === 'terminal-size-owner' &&
        frame['owner'] === 'android' &&
        frame['ownedByRequester'] === true,
    ).length;
    sendFrame(first, { type: 'terminal-size-claim' });
    sendFrame(second, { type: 'terminal-size-release' });
    await vi.waitFor(() => {
      const ownerFrames = firstFrames.frames.filter(
        (frame) =>
          frame['type'] === 'terminal-size-owner' &&
          frame['owner'] === 'android' &&
          frame['ownedByRequester'] === true,
      );
      expect(ownerFrames).toHaveLength(firstOwnerFramesBeforeRelease + 1);
    });

    sendFrame(second, { type: 'terminal-size-claim' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    sendFrame(first, { type: 'terminal-size-claim' });
    sendFrame(first, { type: 'resize', cols: 75, rows: 22 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(backend.resizes.at(-1)).toEqual([80, 25]);

    const firstOwnerFramesBeforeExpiry = firstFrames.frames.filter(
      (frame) =>
        frame['type'] === 'terminal-size-owner' &&
        frame['owner'] === 'android' &&
        frame['ownedByRequester'] === true,
    ).length;
    await vi.waitFor(
      () => {
        const ownerFrames = firstFrames.frames.filter(
          (frame) =>
            frame['type'] === 'terminal-size-owner' &&
            frame['owner'] === 'android' &&
            frame['ownedByRequester'] === true,
        );
        expect(ownerFrames).toHaveLength(firstOwnerFramesBeforeExpiry + 1);
      },
      { timeout: 1_500, interval: 10 },
    );
    sendFrame(first, { type: 'resize', cols: 75, rows: 22 });
    await vi.waitFor(() => expect(backend.resizes.at(-1)).toEqual([75, 22]));

    first.close();
    await waitForClose(first);
    await vi.waitFor(() => expect(backend.resizes.at(-1)).toEqual([160, 48]));
    expect(
      await secondFrames.waitForMatch(
        'terminal-size-owner',
        (frame) => frame['owner'] === 'station' && frame['ownedByRequester'] === false,
      ),
    ).toBeDefined();
    workstation.dispose();
  });

  it('releases ownership on disconnect and requires a fresh claim after reconnect', async () => {
    const backend = new RecordingBackend();
    const session = new Session({ backend, ownershipLeaseMs: 10_000 });
    sessions.push(session);
    const workstation = session.attachLocalTerminal({ onOutput() {} });
    workstation.resize(150, 45);
    const server = await startServer({ session });
    servers.push(server);

    const first = new WebSocket(server.url);
    const firstFrames = frameBuffer(first);
    await waitForOpen(first);
    conns.push(first);
    await firstFrames.waitFor('session-snapshot');
    sendFrame(first, { type: 'terminal-size-claim' });
    sendFrame(first, { type: 'resize', cols: 70, rows: 22 });
    await vi.waitFor(() => expect(backend.resizes.at(-1)).toEqual([70, 22]));

    first.close();
    await waitForClose(first);
    await vi.waitFor(() => expect(backend.resizes.at(-1)).toEqual([150, 45]));

    const second = new WebSocket(server.url);
    const secondFrames = frameBuffer(second);
    await waitForOpen(second);
    conns.push(second);
    await secondFrames.waitFor('session-snapshot');
    sendFrame(second, { type: 'resize', cols: 60, rows: 18 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(backend.resizes.at(-1)).toEqual([150, 45]);

    sendFrame(second, { type: 'terminal-size-claim' });
    sendFrame(second, { type: 'resize', cols: 60, rows: 18 });
    await vi.waitFor(() => expect(backend.resizes.at(-1)).toEqual([60, 18]));
    workstation.dispose();
  });

  it('expires an unrefreshed size ownership lease and restores Station dimensions', async () => {
    const backend = new RecordingBackend();
    const session = new Session({ backend, ownershipLeaseMs: 50 });
    sessions.push(session);
    const workstation = session.attachLocalTerminal({ onOutput() {} });
    workstation.resize(140, 42);
    const server = await startServer({ session });
    servers.push(server);
    const ws = new WebSocket(server.url);
    const frames = frameBuffer(ws);
    await waitForOpen(ws);
    conns.push(ws);
    await frames.waitFor('session-snapshot');

    sendFrame(ws, { type: 'terminal-size-claim' });
    sendFrame(ws, { type: 'resize', cols: 65, rows: 19 });
    await vi.waitFor(() => expect(backend.resizes).toContainEqual([65, 19]));
    await vi.waitFor(() => expect(backend.resizes.at(-1)).toEqual([140, 42]), {
      timeout: 1_000,
      interval: 10,
    });
    expect(
      await frames.waitForMatch(
        'terminal-size-owner',
        (frame) => frame['owner'] === 'station' && frame['ownedByRequester'] === false,
      ),
    ).toBeDefined();
    workstation.dispose();
  });

  it('releases ownership and completes disconnect cleanup when Station restoration fails', async () => {
    const backend = new FailingRestoreBackend();
    const session = new Session({ backend, ownershipLeaseMs: 10_000 });
    sessions.push(session);
    const workstation = session.attachLocalTerminal({ onOutput() {} });
    workstation.resize(140, 42);
    const server = await startServer({ session });
    servers.push(server);
    const first = new WebSocket(server.url);
    const firstFrames = frameBuffer(first);
    await waitForOpen(first);
    conns.push(first);
    await firstFrames.waitFor('session-snapshot');
    sendFrame(first, { type: 'terminal-size-claim' });
    sendFrame(first, { type: 'resize', cols: 65, rows: 19 });
    await vi.waitFor(() => expect(backend.resizes.at(-1)).toEqual([65, 19]));

    backend.failNextResize = true;
    first.close();
    await waitForClose(first);

    const second = new WebSocket(server.url);
    const secondFrames = frameBuffer(second);
    await waitForOpen(second);
    conns.push(second);
    await secondFrames.waitFor('session-snapshot');
    expect(
      await secondFrames.waitForMatch(
        'terminal-size-owner',
        (frame) => frame['owner'] === 'station' && frame['ownedByRequester'] === false,
      ),
    ).toBeDefined();
    workstation.dispose();
  });

  it('shares input and resulting PTY output between Android and the workstation', async () => {
    const backend = new RecordingBackend();
    const session = new Session({ backend });
    sessions.push(session);
    const workstationOutput: string[] = [];
    const terminal = session.attachLocalTerminal({
      onOutput: (data) => workstationOutput.push(data),
    });

    const server = await startServer({ session });
    servers.push(server);
    const ws = new WebSocket(server.url);
    await waitForOpen(ws);
    conns.push(ws);

    sendFrame(ws, { type: 'input', data: 'from Android\r' });
    await vi.waitFor(() => expect(backend.writes).toContain('from Android\r'));
    const androidResult = collectOutput(ws, (data) => data.includes('android result'));
    backend.emit('from Android\r\nandroid result\r\n');

    expect(await androidResult).toContain('android result');
    expect(workstationOutput.join('')).toContain('from Android\r\nandroid result\r\n');

    terminal.input('from workstation\r');
    expect(backend.writes).toContain('from workstation\r');
    const workstationResult = collectOutput(ws, (data) => data.includes('workstation result'));
    backend.emit('from workstation\r\nworkstation result\r\n');

    expect(await workstationResult).toContain('workstation result');
    expect(workstationOutput.join('')).toContain('from workstation\r\nworkstation result\r\n');
  });
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
  readonly frames: Record<string, unknown>[];
  waitFor(type: string, timeoutMs?: number): Promise<Record<string, unknown>>;
  waitForMatch(
    type: string,
    predicate: (frame: Record<string, unknown>) => boolean,
    timeoutMs?: number,
  ): Promise<Record<string, unknown>>;
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
    frames,
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
    async waitForMatch(
      type: string,
      predicate: (frame: Record<string, unknown>) => boolean,
      timeoutMs = 5000,
    ): Promise<Record<string, unknown>> {
      await vi.waitFor(
        () => {
          expect(frames.some((frame) => frame['type'] === type && predicate(frame))).toBe(true);
        },
        { timeout: timeoutMs, interval: 50 },
      );
      return frames.find((frame) => frame['type'] === type && predicate(frame))!;
    },
    getNonce(): string {
      const challenge = frames.find((f) => f['type'] === 'auth-challenge');
      return challenge?.['nonce'] as string;
    },
  };
}

describe('handshake: version negotiation + auth', () => {
  it('captures backend state in a Session Snapshot before live output', async () => {
    const auth = new AuthManager('test-station');
    auth.setTunnelUrl('ws://test:9999');
    const code = auth.generatePairingCode();
    const { publicKeyPem, privateKeyPem } = generateKeyPair();
    pairDevice(auth, code, 'device-1', publicKeyPem, privateKeyPem);
    const backend = new RecordingBackend('previous command\r\nprevious output\r\n', () => {
      backend.emit('output during initial screen capture\r\n');
    });
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
    await vi.waitFor(() =>
      expect(received.some((frame) => frame['type'] === 'auth-challenge')).toBe(true),
    );
    const nonce = received.find((frame) => frame['type'] === 'auth-challenge')!['nonce'] as string;
    sendFrame(ws, {
      type: 'auth-response',
      deviceId: 'device-1',
      signature: signNonce(privateKeyPem, nonce),
    });
    await vi.waitFor(() =>
      expect(received.some((frame) => frame['type'] === 'session-snapshot')).toBe(true),
    );
    backend.emit('live output\r\n');
    await vi.waitFor(() =>
      expect(received.filter((frame) => frame['type'] === 'output')).toHaveLength(1),
    );

    const snapshot = received.find((frame) => frame['type'] === 'session-snapshot') as {
      grid: Array<Array<{ chars: string }>>;
    };
    expect(
      snapshot.grid
        .flat()
        .map((cell) => cell.chars)
        .join(''),
    ).toContain('previous output');
    expect(
      snapshot.grid
        .flat()
        .map((cell) => cell.chars)
        .join(''),
    ).toContain('output during initial screen capture');
    const terminalFrames = received.filter((frame) =>
      ['auth-ok', 'terminal-size-owner', 'resize', 'session-snapshot', 'output'].includes(
        String(frame['type']),
      ),
    );
    expect(terminalFrames.map((frame) => frame['type'])).toEqual([
      'auth-ok',
      'terminal-size-owner',
      'resize',
      'session-snapshot',
      'output',
    ]);
    expect(terminalFrames[1]).toMatchObject({
      owner: 'station',
      ownedByRequester: false,
    });
    expect(terminalFrames.at(-1)?.['data']).toBe('live output\r\n');
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

    await vi.waitFor(() =>
      expect(alerts).toEqual([{ type: 'alert', message: 'Approve deployment?' }]),
    );
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

  it('disconnects an authenticated device when its binding is revoked', async () => {
    const bindings = new MemoryBindingRepository();
    const auth = new AuthManager('test-station', bindings);
    auth.setTunnelUrl('ws://test:9999');
    const code = auth.generatePairingCode();
    const { publicKeyPem, privateKeyPem } = generateKeyPair();
    pairDevice(auth, code, 'device-1', publicKeyPem, privateKeyPem);

    const session = new Session({ cols: 80, rows: 24, auth, revocationCheckIntervalMs: 50 });
    sessions.push(session);
    const server = await startServer({ session });
    servers.push(server);

    const ws = new WebSocket(server.url);
    await waitForOpen(ws);
    conns.push(ws);
    const fb = frameBuffer(ws);

    sendFrame(ws, { type: 'hello', protocolVersion: PROTOCOL_VERSION });
    const challenge = await fb.waitFor('auth-challenge');
    sendFrame(ws, {
      type: 'auth-response',
      deviceId: 'device-1',
      signature: signNonce(privateKeyPem, challenge['nonce'] as string),
    });
    await fb.waitFor('session-snapshot');

    expect(bindings.revoke('device-1')).toBe(true);
    expect(await waitForCloseCode(ws)).toBe(WS_CLOSE_CODES.AUTH_REJECTED);

    // A fresh handshake from the revoked device is rejected as well.
    const reconnect = new WebSocket(server.url);
    await waitForOpen(reconnect);
    conns.push(reconnect);
    const reconnectFrames = frameBuffer(reconnect);
    sendFrame(reconnect, { type: 'hello', protocolVersion: PROTOCOL_VERSION });
    const reconnectChallenge = await reconnectFrames.waitFor('auth-challenge');
    sendFrame(reconnect, {
      type: 'auth-response',
      deviceId: 'device-1',
      signature: signNonce(privateKeyPem, reconnectChallenge['nonce'] as string),
    });
    expect(await waitForCloseCode(reconnect)).toBe(WS_CLOSE_CODES.AUTH_REJECTED);
  }, 15000);
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
