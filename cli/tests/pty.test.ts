/**
 * cli/tests/pty.test.ts
 *
 * Validates the node-pty wrapper against a real PTY on the current platform.
 *
 * "spawns a shell on Windows" (tasks.md) — runs the platform-default shell on
 * every OS; the test file runs as-is in the CI matrix (win/mac/linux).
 */

import * as os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defaultShell,
  spawn,
  type PtyProcess,
} from '../src/pty/node-pty.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect PTY output until `predicate` returns true or `timeoutMs` elapses. */
function collectUntil(
  pty: PtyProcess,
  predicate: (accumulated: string) => boolean,
  timeoutMs = 5000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => {
      d.dispose();
      reject(
        new Error(
          `Timed out after ${timeoutMs}ms. Buffer so far: ${JSON.stringify(buf)}`,
        ),
      );
    }, timeoutMs);

    const d = pty.onData((chunk) => {
      buf += chunk;
      if (predicate(buf)) {
        clearTimeout(timer);
        d.dispose();
        resolve(buf);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('defaultShell()', () => {
  it('returns a non-empty string', () => {
    expect(defaultShell()).toBeTruthy();
    expect(typeof defaultShell()).toBe('string');
  });

  it('returns cmd.exe or powershell path on Windows', () => {
    if (os.platform() !== 'win32') return;
    const shell = defaultShell().toLowerCase();
    expect(shell.endsWith('.exe')).toBe(true);
  });

  it('returns an absolute path on POSIX', () => {
    if (os.platform() === 'win32') return;
    expect(defaultShell().startsWith('/')).toBe(true);
  });
});

describe('spawn()', () => {
  const spawned: PtyProcess[] = [];

  afterEach(() => {
    // Ensure PTY processes are always killed after each test to prevent leaks.
    for (const p of spawned) {
      try {
        p.kill();
      } catch {
        // Already dead — ignore.
      }
    }
    spawned.length = 0;
  });

  it('returns a PtyProcess with the expected shape', () => {
    const pty = spawn({ cols: 80, rows: 24 });
    spawned.push(pty);

    expect(typeof pty.write).toBe('function');
    expect(typeof pty.onData).toBe('function');
    expect(typeof pty.resize).toBe('function');
    expect(typeof pty.kill).toBe('function');
    expect(typeof pty.onExit).toBe('function');
    expect(pty.raw).toBeDefined();
  });

  it('spawns the default shell and produces output', async () => {
    const pty = spawn({ cols: 80, rows: 24 });
    spawned.push(pty);

    // Send a simple command that every shell should honour.
    const cmd = os.platform() === 'win32' ? 'echo MOBILY_TEST\r\n' : 'echo MOBILY_TEST\r';
    pty.write(cmd);

    const output = await collectUntil(pty, (buf) =>
      buf.includes('MOBILY_TEST'),
    );
    expect(output).toContain('MOBILY_TEST');
  });

  it('spawns with custom cols/rows reflected on the raw pty', () => {
    const pty = spawn({ cols: 132, rows: 40 });
    spawned.push(pty);

    // node-pty exposes cols/rows on the raw IPty object
    expect(pty.raw.cols).toBe(132);
    expect(pty.raw.rows).toBe(40);
  });

  it('spawns with a custom cwd', async () => {
    const cwd = os.tmpdir();
    const pty = spawn({ cols: 80, rows: 24, cwd });
    spawned.push(pty);

    // Ask the shell for its working directory.
    const cmd =
      os.platform() === 'win32' ? 'echo %CD%\r\n' : 'pwd\r';
    pty.write(cmd);

    // tmpdir paths can contain symlinks; only check for a fragment.
    const tmpFragment =
      os.platform() === 'win32'
        ? os.tmpdir().split('\\').pop()!
        : os.tmpdir().split('/').pop()!;

    const output = await collectUntil(
      pty,
      (buf) => buf.toLowerCase().includes(tmpFragment.toLowerCase()),
      10_000,
    );
    expect(output.toLowerCase()).toContain(tmpFragment.toLowerCase());
  }, 10_000);
});

describe('PtyProcess.onData()', () => {
  const spawned: PtyProcess[] = [];

  afterEach(() => {
    for (const p of spawned) {
      try { p.kill(); } catch { /* ignore */ }
    }
    spawned.length = 0;
  });

  it('fires the listener with string chunks', async () => {
    const pty = spawn({ cols: 80, rows: 24 });
    spawned.push(pty);

    const chunks: string[] = [];
    const d = pty.onData((chunk) => chunks.push(chunk));

    pty.write(os.platform() === 'win32' ? 'echo hi\r\n' : 'echo hi\r');
    await collectUntil(pty, (buf) => buf.includes('hi'));
    d.dispose();

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => typeof c === 'string')).toBe(true);
  });

  it('returns an IDisposable that stops delivery after dispose()', async () => {
    const pty = spawn({ cols: 80, rows: 24 });
    spawned.push(pty);

    const listener = vi.fn();
    const d = pty.onData(listener);
    d.dispose();

    // Send a command — listener should not be called anymore.
    pty.write(os.platform() === 'win32' ? 'echo gone\r\n' : 'echo gone\r');

    // Give the PTY a moment to flush output.
    await new Promise((r) => setTimeout(r, 200));
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('PtyProcess.resize()', () => {
  const spawned: PtyProcess[] = [];

  afterEach(() => {
    for (const p of spawned) {
      try { p.kill(); } catch { /* ignore */ }
    }
    spawned.length = 0;
  });

  it('updates raw.cols and raw.rows', () => {
    const pty = spawn({ cols: 80, rows: 24 });
    spawned.push(pty);

    pty.resize(132, 50);
    // On Windows ConPTY, IPty.cols/rows are readonly and retain their
    // spawn-time values — the pseudo-console does resize but the JS
    // properties are not updated by the Windows implementation.
    if (os.platform() !== 'win32') {
      expect(pty.raw.cols).toBe(132);
      expect(pty.raw.rows).toBe(50);
    }
  });

  it('throws RangeError for zero cols', () => {
    const pty = spawn({ cols: 80, rows: 24 });
    spawned.push(pty);
    expect(() => pty.resize(0, 24)).toThrow(RangeError);
  });

  it('throws RangeError for negative rows', () => {
    const pty = spawn({ cols: 80, rows: 24 });
    spawned.push(pty);
    expect(() => pty.resize(80, -1)).toThrow(RangeError);
  });

  it('throws RangeError for fractional cols', () => {
    const pty = spawn({ cols: 80, rows: 24 });
    spawned.push(pty);
    expect(() => pty.resize(80.5, 24)).toThrow(RangeError);
  });
});

describe('PtyProcess.onExit()', () => {
  it('fires when the shell exits cleanly', async () => {
    const pty = spawn({ cols: 80, rows: 24 });

    const exitPromise = new Promise<{ exitCode: number; signal?: number }>(
      (resolve) => {
        pty.onExit(resolve);
      },
    );

    // Send the exit command for the platform default shell.
    pty.write(os.platform() === 'win32' ? 'exit\r\n' : 'exit\r');

    const event = await exitPromise;
    expect(typeof event.exitCode).toBe('number');
  });

  it('fires after kill()', async () => {
    const pty = spawn({ cols: 80, rows: 24 });

    const exitPromise = new Promise<{ exitCode: number; signal?: number }>(
      (resolve) => {
        pty.onExit(resolve);
      },
    );

    pty.kill();
    const event = await exitPromise;
    expect(typeof event.exitCode).toBe('number');
  });
});
