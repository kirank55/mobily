/**
 * Issue 03 — Prevent queued terminal mouse reports from leaking into the shell
 * (`.scratch/android-terminal-rash-bugs/issues/03-prevent-queued-mouse-report-leaks.md`).
 *
 * End-to-end coverage over the real wire protocol: a WebSocket client
 * (standing in for the Android app) sends SGR mouse-report `input` frames to a
 * mouse-enabled TUI running in a bare PTY bash behind `Session` + `startServer`.
 * While the TUI is stalled, the packets queue unread in the PTY input buffer.
 * The Session's MouseReportingGuard tracks mouse ownership on the output
 * stream and, at the `[mobily] ` prompt boundary, writes VINTR so the line
 * discipline discards the queued packets (and SIGINT aborts any readline line
 * they already polluted) — the shell returns to a clean, empty prompt and no
 * queued packet can execute as a command. Clean (SIGTERM + DECRST) and abrupt
 * (SIGKILL) exits are both covered, alongside the happy path: clicks, wheel
 * packets, and plain keys still reach an active mouse-enabled TUI.
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
const stalledFixturePath = fileURLToPath(
  new URL('./fixtures/stalled-mouse-tui.mjs', import.meta.url),
);
const readingFixturePath = fileURLToPath(
  new URL('./fixtures/reading-mouse-tui.mjs', import.meta.url),
);

/** SGR 1006 motion packets (button 35), mirroring the ticket's on-device capture. */
const MOUSE_PACKETS = ['\x1b[<35;5;3M', '\x1b[<35;18;14M', '\x1b[<35;33;5M', '\x1b[<35;46;16M'];
/** Literal text readline ends up with once the escape prefixes are discarded. */
const LEAKED_FRAGMENTS = ['35;5;3M', '35;18;14M', '35;33;5M', '35;46;16M'];
/** bash echoes ^C when the guard's VINTR interrupts the idle prompt. */
const FLUSH_MARKER = '^C';

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
  'queued mouse reports and the process boundary (issue 03)',
  () => {
    it('abrupt kill: the boundary flush discards queued mouse reports before the shell reads them', async () => {
      const result = await runStalledTuiScenario('SIGKILL');

      expect(result.queuedWhileStalled).toBe(true);
      // The guard flushed at the prompt boundary; everything after the
      // interrupt is free of mouse-report text — including the stale packet
      // sent after the flush and the final prompt line.
      expect(result.afterEnter).toContain(FLUSH_MARKER);
      const afterFlush = result.afterEnter.slice(result.afterEnter.indexOf(FLUSH_MARKER));
      for (const fragment of LEAKED_FRAGMENTS) {
        expect(afterFlush).not.toContain(fragment);
      }
      expect(result.afterEnter).not.toContain('command not found');
    }, 30_000);

    it('clean exit: queued mouse reports are discarded despite a proper DECRST', async () => {
      const result = await runStalledTuiScenario('SIGTERM');

      // The TUI left the alternate screen and cleared mouse modes correctly.
      expect(result.postBoundary).toContain('\x1b[?1003l');
      expect(result.queuedWhileStalled).toBe(true);
      expect(result.afterEnter).toContain(FLUSH_MARKER);
      const afterFlush = result.afterEnter.slice(result.afterEnter.indexOf(FLUSH_MARKER));
      for (const fragment of LEAKED_FRAGMENTS) {
        expect(afterFlush).not.toContain(fragment);
      }
      expect(result.afterEnter).not.toContain('command not found');
    }, 30_000);

    it('mouse clicks, wheel packets, and keys still reach an active mouse-enabled TUI', async () => {
      const client = await attachWireClient();
      const pid = await launchTui(client, readingFixturePath, 'READING MOUSE TUI pid=');

      const click = '\x1b[<0;5;3M\x1b[<0;5;3m';
      const wheel = '\x1b[<64;10;5M';
      const motion = '\x1b[<35;7;9M';
      client.sendInput(click);
      client.sendInput(wheel);
      client.sendInput(motion);
      client.sendInput('q');
      // The fixture prints TUI_GOT <JSON> per stdin chunk; JSON.stringify
      // renders ESC as the escaped text \u001b — assert on that form so
      // chunking cannot matter.
      await client.waitFor('TUI_GOT');
      await vi.waitFor(
        () => {
          const out = client.output();
          expect(out).toContain('\\u001b[<0;5;3M');
          expect(out).toContain('\\u001b[<64;10;5M');
          expect(out).toContain('\\u001b[<35;7;9M');
          // Plain keys also arrive; frames may coalesce into one stdin chunk.
          expect(out).toMatch(/TUI_GOT "[^"]*q/);
        },
        { timeout: 10_000 },
      );

      client.clear();
      process.kill(pid, 'SIGTERM');
      await client.waitFor(PROMPT);
      client.sendInput('\r');
      await vi.waitFor(
        () => expect(occurrences(client.output(), PROMPT)).toBeGreaterThanOrEqual(2),
        {
          timeout: 10_000,
        },
      );
      expect(client.output()).not.toContain('command not found');
    }, 30_000);

    it('a keyboard-only TUI session does not interrupt the returning shell', async () => {
      const client = await attachWireClient();
      const pid = await launchTui(client, readingFixturePath, 'READING MOUSE TUI pid=');

      client.sendInput('x');
      await client.waitFor('TUI_GOT "x"');

      client.clear();
      process.kill(pid, 'SIGTERM');
      await client.waitFor(PROMPT);
      // No mouse reports were forwarded, so the guard must not fire: exactly
      // one prompt, no interrupt marker.
      await sleep(600);
      const postBoundary = client.output();
      expect(postBoundary).not.toContain(FLUSH_MARKER);
      expect(occurrences(postBoundary, PROMPT)).toBe(1);

      client.sendInput('echo STILL_ALIVE\r');
      await client.waitFor('STILL_ALIVE');
    }, 30_000);
  },
);

interface StalledTuiScenarioResult {
  /** True when the queued packets produced no output while the TUI was stalled. */
  queuedWhileStalled: boolean;
  /** Output from signalling the TUI until the flush interrupt appeared. */
  postBoundary: string;
  /** Output through the stale packet and Enter that follow the flush. */
  afterEnter: string;
}

async function runStalledTuiScenario(
  signal: 'SIGKILL' | 'SIGTERM',
): Promise<StalledTuiScenarioResult> {
  const client = await attachWireClient();
  const pid = await launchTui(client, stalledFixturePath, 'STALLED MOUSE TUI pid=');

  // Pointer movement while the mouse-enabled TUI is stalled: the Android app
  // forwards these as ordinary input frames, which queue unread in the PTY.
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
  await client.waitFor(FLUSH_MARKER);
  const postBoundary = client.output();

  // A stale in-flight packet right after the boundary must be dropped, then a
  // normal keypress must find an empty command line.
  client.sendInput(MOUSE_PACKETS[0]!);
  await sleep(400);
  client.sendInput('\r');
  await vi.waitFor(() => expect(occurrences(client.output(), PROMPT)).toBeGreaterThanOrEqual(3), {
    timeout: 10_000,
  });
  const afterEnter = client.output();

  return { queuedWhileStalled, postBoundary, afterEnter };
}

async function launchTui(client: WireClient, fixturePath: string, marker: string): Promise<number> {
  // The shell's first prompt predates the WebSocket attach, so sync on a live
  // echo marker instead — everything from here on streams as output frames.
  client.sendInput('echo MOBILY_WIRE_READY\r');
  await client.waitFor('MOBILY_WIRE_READY');
  await client.waitFor(PROMPT);
  client.clear();
  client.sendInput(`node ${shellQuote(fixturePath)}\r`);
  await client.waitFor(marker);
  const pid = Number(client.output().match(new RegExp(`${marker}(\\d+)`))![1]);
  tuiPids.push(pid);
  // Let the fixture finish applying raw mode so queued bytes cannot echo early.
  await sleep(250);
  return pid;
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
