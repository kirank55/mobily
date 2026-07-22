import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, type RawData } from 'ws';
import type { SessionScrollbackFrame, SessionSnapshotFrame } from '@mobily/shared';
import { BareBackend } from '../src/mux/bare.js';
import { TmuxBackend } from '../src/mux/tmux.js';
import { defaultSessionRuntime } from '../src/mux/runtime.js';
import type { SessionBackend } from '../src/mux/types.js';
import { spawn } from '../src/pty/node-pty.js';
import { Session } from '../src/session.js';
import { startServer, type Server } from '../src/ws.js';

const COLS = 40;
const ROWS = 8;
const fixturePath = fileURLToPath(new URL('./fixtures/full-screen.mjs', import.meta.url));
const sessions: Session[] = [];
const servers: Server[] = [];
const sockets: WebSocket[] = [];
const temporaryDirectories: string[] = [];
const tmuxSessions: string[] = [];

const tmuxAvailable = (() => {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

afterEach(async () => {
  for (const socket of sockets) socket.close();
  sockets.length = 0;
  for (const server of servers) await server.close();
  servers.length = 0;
  for (const session of sessions) session.dispose();
  sessions.length = 0;
  for (const name of tmuxSessions) {
    try {
      execFileSync('tmux', ['kill-session', '-t', name], { stdio: 'ignore' });
    } catch {
      // The test may already have stopped the session.
    }
  }
  tmuxSessions.length = 0;
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.length = 0;
});

describe('full-screen Session Snapshot integration', () => {
  it('captures the idle full-screen fixture from a real bare PTY', async () => {
    const snapshot = await captureSnapshot(createBareBackend());

    assertFullScreenSnapshot(snapshot);
  }, 20_000);

  it.skipIf(!tmuxAvailable)(
    'captures the same idle full-screen fixture from a real tmux Session',
    async () => {
      const bareSnapshot = await captureSnapshot(createBareBackend());
      const tmuxSnapshot = await captureSnapshot(createTmuxBackend());

      expect(normalizeVisibleSnapshot(tmuxSnapshot)).toEqual(
        normalizeVisibleSnapshot(bareSnapshot),
      );
    },
    20_000,
  );

  it.skipIf(!tmuxAvailable)(
    'reconstructs the visible pane instead of tmux replay history',
    async () => {
      const bareSnapshot = await captureSnapshot(createBareBackend());
      const recoveredTmuxSnapshot = await captureIdleSnapshot(await createExistingTmuxBackend());

      expect(normalizeVisibleSnapshot(recoveredTmuxSnapshot)).toEqual(
        normalizeVisibleSnapshot(bareSnapshot),
      );
    },
    20_000,
  );

  it.skipIf(!tmuxAvailable)(
    'transfers bounded history from a real tmux Session only after snapshot paint',
    async () => {
      const backend = await createExistingTmuxBackend();
      const session = new Session({ backend, cols: COLS, rows: ROWS });
      sessions.push(session);

      const history = await captureSessionScrollback(session);

      expect(history).toContain('READY redraw');
      expect(history.length).toBeLessThanOrEqual(512 * 1024);
    },
    20_000,
  );
});

function createBareBackend(): SessionBackend {
  const cwd = mkdtempSync(join(tmpdir(), 'mobily-bare-screen-'));
  temporaryDirectories.push(cwd);
  return new BareBackend({
    file: '/bin/sh',
    cwd,
    cols: COLS,
    rows: ROWS,
  });
}

function createTmuxBackend(): SessionBackend {
  const cwd = mkdtempSync(join(tmpdir(), 'mobily-tmux-screen-'));
  temporaryDirectories.push(cwd);
  const name = `mobily-snapshot-${process.pid}-${Date.now()}`;
  tmuxSessions.push(name);
  return new TmuxBackend({
    cwd,
    sessionName: name,
    cols: COLS,
    rows: ROWS,
  });
}

async function createExistingTmuxBackend(): Promise<SessionBackend> {
  const cwd = mkdtempSync(join(tmpdir(), 'mobily-existing-tmux-screen-'));
  temporaryDirectories.push(cwd);
  const name = `mobily-existing-snapshot-${process.pid}-${Date.now()}`;
  tmuxSessions.push(name);
  execFileSync('tmux', [
    'new-session',
    '-d',
    '-s',
    name,
    '-x',
    String(COLS),
    '-y',
    String(ROWS),
    '-c',
    cwd,
    `printf 'STALE_TMUX_HISTORY\\n'; exec ${shellQuote(process.execPath)} ${shellQuote(fixturePath)}`,
  ]);
  await vi.waitFor(() =>
    expect(
      execFileSync('tmux', ['capture-pane', '-p', '-t', name], { encoding: 'utf8' }),
    ).toContain('READY redraw'),
  );
  return new TmuxBackend(
    {
      cwd,
      sessionName: name,
      cols: COLS,
      rows: ROWS,
    },
    {
      ...defaultSessionRuntime,
      spawnPty(options) {
        return spawn({
          ...options,
          file: '/bin/sh',
          args: ['-c', 'sleep 60'],
        });
      },
    },
  );
}

async function captureSnapshot(backend: SessionBackend): Promise<SessionSnapshotFrame> {
  const session = new Session({ backend, cols: COLS, rows: ROWS });
  sessions.push(session);
  let workstationOutput = '';
  const workstation = session.attachLocalTerminal({
    onOutput(data) {
      workstationOutput += data;
    },
  });
  workstation.input(`exec ${shellQuote(process.execPath)} ${shellQuote(fixturePath)}\r`);
  await vi.waitFor(() => expect(workstationOutput).toContain('READY redraw'), {
    timeout: 10_000,
  });
  workstation.dispose();

  return captureSessionSnapshot(session);
}

async function captureIdleSnapshot(backend: SessionBackend): Promise<SessionSnapshotFrame> {
  const session = new Session({ backend, cols: COLS, rows: ROWS });
  sessions.push(session);
  return captureSessionSnapshot(session);
}

async function captureSessionSnapshot(session: Session): Promise<SessionSnapshotFrame> {
  const server = await startServer({ session });
  servers.push(server);
  const socket = new WebSocket(server.url);
  sockets.push(socket);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Session Snapshot timed out')), 10_000);
    socket.on('message', (raw: RawData) => {
      const frame = JSON.parse(raw.toString()) as SessionSnapshotFrame;
      if (frame.type !== 'session-snapshot') return;
      clearTimeout(timeout);
      resolve(frame);
    });
    socket.on('error', reject);
  });
}

async function captureSessionScrollback(session: Session): Promise<string> {
  const server = await startServer({ session });
  servers.push(server);
  const socket = new WebSocket(server.url);
  sockets.push(socket);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Session scrollback timed out')), 10_000);
    const chunks: string[] = [];
    socket.on('message', (raw: RawData) => {
      const frame = JSON.parse(raw.toString()) as { type?: unknown };
      if (frame.type === 'session-snapshot') {
        expect(chunks).toEqual([]);
        socket.send(JSON.stringify({ type: 'session-snapshot-applied' }));
        return;
      }
      if (frame.type !== 'session-scrollback') return;
      const scrollback = frame as SessionScrollbackFrame;
      chunks.push(scrollback.data);
      if (!scrollback.done) return;
      clearTimeout(timeout);
      resolve(chunks.join(''));
    });
    socket.on('error', reject);
  });
}

function assertFullScreenSnapshot(snapshot: SessionSnapshotFrame): void {
  const lines = snapshot.grid.map((line) => line.map((cell) => cell.chars).join(''));
  expect(snapshot).toMatchObject({
    cols: COLS,
    rows: ROWS,
    activeScreen: 'alternate',
    cursor: { col: 4, row: 6, visible: false, style: 'block', blink: true },
  });
  expect(lines[0]).toContain('OpenCode');
  expect(lines[1]).toContain('┌─ workspace');
  expect(lines[2]).toContain('model: GPT-5');
  expect(lines[3]).toContain('✓ READY redraw');
  expect(lines.join('\n')).not.toContain('STALE');
  expect(lines[4]).toContain('plan 界 step');
  expect(lines[5]).toContain('implement issue 2');
  expect(lines[7]).toBe('');
  expect(snapshot.grid[0]![0]).toMatchObject({
    chars: ' ',
    width: 1,
    fg: { mode: 'rgb', value: 0x12abef },
    bg: { mode: 'palette', value: 17 },
    attrs: 1,
  });
  const wideCell = snapshot.grid[4]!.find((cell) => cell.chars === '界');
  expect(wideCell).toMatchObject({ chars: '界', width: 2 });
}

function normalizeVisibleSnapshot(snapshot: SessionSnapshotFrame): SessionSnapshotFrame {
  return {
    ...snapshot,
    grid: snapshot.grid.map((row) =>
      row.map((cell) =>
        cell.chars === ' ' &&
        cell.width === 1 &&
        cell.fg === undefined &&
        cell.bg === undefined &&
        cell.attrs === undefined
          ? { chars: '', width: 1 }
          : cell,
      ),
    ),
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
