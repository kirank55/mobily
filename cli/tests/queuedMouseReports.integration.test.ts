/**
 * Issue 03 — Prevent queued terminal mouse reports from leaking into the shell
 * (`.scratch/android-terminal-rash-bugs/issues/03-prevent-queued-mouse-report-leaks.md`).
 *
 * End-to-end reproduction over the real wire protocol: a WebSocket client
 * (standing in for the Android app) sends SGR mouse-report `input` frames
 * while a mouse-enabled TUI is stalled and not reading stdin. The packets sit
 * unread in the PTY input queue until the TUI exits or is killed — then the
 * returning shell reads them as literal input, exactly like the on-device
 * evidence in the ticket (`35;5;3M35;18;14M...` at the shell prompt).
 *
 * The `...leak...` cases characterize the bug as it exists today; the
 * `it.fails` cases pin the acceptance criteria and start failing loudly as
 * soon as a fix makes the shell receive no queued mouse-report input (remove
 * the `.fails` marker then).
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, type RawData } from 'ws';
import { BareBackend } from '../src/sessionBackend/bare.js';
import { Session } from '../src/session.js';
import { startServer, type Server } from '../src/ws.js';

const COLS = 80;
const ROWS = 24;
const PROMPT = '[mobily] $ ';
const fixturePath = fileURLToPath(new URL('./fixtures/stalled-mouse-tui.mjs', import.meta.url));

/** SGR 1006 motion packets (button 35), mirroring the ticket's on-device capture. */
const MOUSE_PACKETS = ['\x1b[<35;5;3M', '\x1b[<35;18;14M', '\x1b[<35;33;5M', '\x1b[<35;46;16M'];
/** Literal text readline ends up with once the escape prefixes are discarded. */
const LEAKED_FRAGMENTS = ['35;5;3M', '35;18;14M', '35;33;5M', '35;46;16M'];

const sessions: Session[] = [];
const servers: Server[] = [];
const sockets: WebSocket[] = [];
const temporaryDirectories: string[] = [];
const tuiPids: number[] = [];

const bashAvailable = existsSync('/bin/bash');

afterEach(async () => {
  for (const socket of sockets) socket.close();
  sockets.length = 0;
  for (const server of servers) await server.close();
  servers.length = 0;
  for (const session of sessions) session.dispose();
  sessions.length = 0;
  for (const pid of tuiPids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // The test may already have stopped the fixture.
    }
  }
  tuiPids.length = 0;
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.length = 0;
});

describe.skipIf(process.platform === 'win32' || !bashAvailable)(
  'queued mouse reports leaking into the shell (issue 03)',
  () => {
    it('abrupt kill: packets queued while the TUI is stalled leak into the returning shell', async () => {
      const result = await runQueuedMouseScenario('SIGKILL');

      // Bug characterization: the queued packets are unread while the TUI is
      // stalled, then readline adopts them as literal shell input after the
      // process boundary, and Enter executes them as commands.
      expect(result.queuedWhileStalled).toBe(true);
      for (const fragment of LEAKED_FRAGMENTS) {
        expect(result.postBoundary).toContain(fragment);
      }
      expect(result.afterEnter).toContain('bash: 35: command not found');
      expect(result.afterEnter).toContain('bash: 16M: command not found');
    }, 30_000);

    it('clean exit: packets queued while the TUI is stalled leak despite a proper DECRST', async () => {
      const result = await runQueuedMouseScenario('SIGTERM');

      // The TUI leaves the alternate screen and clears mouse modes correctly,
      // yet the packets queued before the boundary still reach the shell.
      expect(result.postBoundary).toContain('\x1b[?1003l');
      expect(result.queuedWhileStalled).toBe(true);
      for (const fragment of LEAKED_FRAGMENTS) {
        expect(result.postBoundary).toContain(fragment);
      }
      expect(result.afterEnter).toContain('bash: 35: command not found');
    }, 30_000);

    it.fails(
      'regression (pending fix): an abruptly killed stalled TUI leaves a clean, empty shell prompt',
      async () => {
        const result = await runQueuedMouseScenario('SIGKILL');

        expect(result.queuedWhileStalled).toBe(true);
        for (const fragment of LEAKED_FRAGMENTS) {
          expect(result.postBoundary).not.toContain(fragment);
        }
        expect(result.afterEnter).not.toContain('command not found');
      },
      30_000,
    );

    it.fails(
      'regression (pending fix): a cleanly exited stalled TUI leaves a clean, empty shell prompt',
      async () => {
        const result = await runQueuedMouseScenario('SIGTERM');

        expect(result.queuedWhileStalled).toBe(true);
        for (const fragment of LEAKED_FRAGMENTS) {
          expect(result.postBoundary).not.toContain(fragment);
        }
        expect(result.afterEnter).not.toContain('command not found');
      },
      30_000,
    );
  },
);

interface QueuedMouseScenarioResult {
  /** True when the queued packets produced no output while the TUI was stalled. */
  queuedWhileStalled: boolean;
  /** Output from signalling the TUI until just before pressing Enter. */
  postBoundary: string;
  /** Output after pressing Enter at the returned prompt. */
  afterEnter: string;
}

async function runQueuedMouseScenario(
  signal: 'SIGKILL' | 'SIGTERM',
): Promise<QueuedMouseScenarioResult> {
  const client = await attachWireClient();

  // The shell's first prompt predates the WebSocket attach, so sync on a live
  // echo marker instead — everything from here on streams as output frames.
  client.sendInput('echo MOBILY_WIRE_READY\r');
  await client.waitFor('MOBILY_WIRE_READY');
  await client.waitFor(PROMPT);
  client.clear();
  client.sendInput(`node ${shellQuote(fixturePath)}\r`);
  await client.waitFor('STALLED MOUSE TUI pid=');
  const pid = Number(client.output().match(/STALLED MOUSE TUI pid=(\d+)/)![1]);
  tuiPids.push(pid);
  // Let the fixture finish applying raw mode so the queued bytes cannot echo early.
  await sleep(250);

  // Pointer movement while the mouse-enabled TUI is stalled: the Android app
  // forwards these as ordinary input frames.
  client.clear();
  client.sendInput(MOUSE_PACKETS.slice(0, 2).join(''));
  client.sendInput(MOUSE_PACKETS.slice(2).join(''));
  await sleep(500);
  const queuedWhileStalled = !LEAKED_FRAGMENTS.some((fragment) =>
    client.output().includes(fragment),
  );

  client.clear();
  process.kill(pid, signal);
  await client.waitFor(PROMPT);
  // Readline needs a moment to drain the already-queued bytes and redraw.
  await sleep(500);
  const postBoundary = client.output();

  // A normal post-boundary keypress: does the shell command line contain mouse?
  client.sendInput('\r');
  await vi.waitFor(() => expect(occurrences(client.output(), PROMPT)).toBeGreaterThanOrEqual(2), {
    timeout: 10_000,
  });
  const afterEnter = client.output();

  return { queuedWhileStalled, postBoundary, afterEnter };
}

interface WireClient {
  output(): string;
  clear(): void;
  sendInput(data: string): void;
  waitFor(needle: string): Promise<void>;
}

async function attachWireClient(): Promise<WireClient> {
  const cwd = mkdtempSync(join(tmpdir(), 'mobily-mouse-leak-'));
  temporaryDirectories.push(cwd);
  const session = new Session({
    backend: new BareBackend({
      file: '/bin/bash',
      args: ['--norc', '-i'],
      cwd,
      cols: COLS,
      rows: ROWS,
      env: { ...(process.env as Record<string, string>), PS1: PROMPT, TERM: 'xterm-256color' },
    }),
    cols: COLS,
    rows: ROWS,
  });
  sessions.push(session);
  const server = await startServer({ session });
  servers.push(server);
  const socket = new WebSocket(server.url);
  sockets.push(socket);

  let buffer = '';
  const ready = new Promise<void>((resolve, reject) => {
    socket.on('message', (raw: RawData) => {
      const frame = JSON.parse(raw.toString()) as { type?: string; data?: string };
      if (frame.type === 'session-snapshot') {
        socket.send(JSON.stringify({ type: 'session-snapshot-applied' }));
        resolve();
        return;
      }
      if (frame.type === 'output' && typeof frame.data === 'string') buffer += frame.data;
    });
    socket.on('error', reject);
  });
  await ready;

  return {
    output: () => buffer,
    clear: () => {
      buffer = '';
    },
    sendInput: (data) => socket.send(JSON.stringify({ type: 'input', data })),
    waitFor: (needle) =>
      vi.waitFor(() => expect(buffer).toContain(needle), { timeout: 10_000 }).then(() => undefined),
  };
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
