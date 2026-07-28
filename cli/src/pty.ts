/**
 * Thin wrapper around `node-pty` that presents a clean, typed surface for the
 * rest of the CLI.
 *
 * Public API
 * ----------
 *   spawn(opts)          → PtyProcess  fork a shell / arbitrary command
 *   process.write(data)              write raw bytes to the PTY stdin
 *   process.onData(cb) → IDisposable  subscribe to PTY stdout
 *   process.resize(cols, rows)       send SIGWINCH with new dimensions
 *   process.kill([signal])           send a signal (POSIX) or terminate (Win)
 *   process.onExit(cb) → IDisposable subscribe to process-exit events
 */

import * as os from 'node:os';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as nodePty from 'node-pty';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SpawnOptions {
  /** Command / shell to execute. Defaults to platform shell. */
  file?: string;
  /** Arguments passed to the command. */
  args?: string[];
  /** Initial terminal columns. @default 80 */
  cols?: number;
  /** Initial terminal rows. @default 24 */
  rows?: number;
  /** Working directory for the child process. @default process.cwd() */
  cwd?: string;
  /** Environment variables. @default process.env */
  env?: Record<string, string>;
  /**
   * Terminal name advertised via `$TERM`. Set to `'xterm-256color'` for
   * maximum compatibility with colour-aware tools (vim, htop, etc.).
   * @default 'xterm-256color'
   */
  terminalName?: string;
}

export interface ExitEvent {
  exitCode: number;
  signal?: number;
}

export interface IDisposable {
  dispose(): void;
}

/**
 * A live PTY process returned by {@link spawn}.
 * All methods are safe to call from the main Node.js thread.
 */
export interface PtyProcess {
  /** The underlying node-pty process (exposed for testing / introspection). */
  readonly raw: nodePty.IPty;
  /** Write raw data to the PTY's stdin. */
  write(data: string): void;
  /** Register a listener for PTY output data. Returns a disposable handle. */
  onData(listener: (data: string) => void): IDisposable;
  /** Resize the PTY window. Both dimensions must be positive integers. */
  resize(cols: number, rows: number): void;
  /**
   * Terminate the PTY process.
   * On POSIX: sends `signal` (defaults to `'SIGHUP'`).
   * On Windows: signal is silently ignored; the process is always force-killed.
   */
  kill(signal?: string): void;
  /** Register a listener for the PTY process exit. Returns a disposable handle. */
  onExit(listener: (event: ExitEvent) => void): IDisposable;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the default shell for the current platform. */
export function defaultShell(
  platform: NodeJS.Platform = os.platform(),
  env: NodeJS.ProcessEnv = process.env,
  fileExists: (candidate: string) => boolean = existsSync,
): string {
  if (platform === 'win32') {
    // Prefer PowerShell (7+ as pwsh, then Windows PowerShell); fall back to
    // cmd.exe. COMSPEC always points at cmd.exe, so it is only a last resort.
    const pathApi = path.win32;
    const directories = (env['PATH'] ?? '').split(pathApi.delimiter).filter(Boolean);
    for (const executable of ['pwsh.exe', 'powershell.exe']) {
      for (const directory of directories) {
        const candidate = pathApi.join(directory, executable);
        if (fileExists(candidate)) return candidate;
      }
    }
    return env['COMSPEC'] ?? 'cmd.exe';
  }
  // POSIX: honour $SHELL if set and the binary actually exists on disk;
  // fall back to /bin/sh which is guaranteed to be present.
  const envShell = env['SHELL'];
  if (envShell && fileExists(envShell)) return envShell;
  return '/bin/sh';
}

// ---------------------------------------------------------------------------
// spawn
// ---------------------------------------------------------------------------

/**
 * Fork a new PTY process.
 *
 * @example
 * ```ts
 * const pty = spawn({ cols: 220, rows: 50 });
 * pty.onData(data => ws.send(data));
 * pty.write('echo hello\r');
 * pty.resize(200, 40);
 * pty.kill();
 * ```
 */
export function spawn(opts: SpawnOptions = {}): PtyProcess {
  const {
    file = defaultShell(),
    args = [],
    cols = 80,
    rows = 24,
    cwd = process.cwd(),
    env = process.env as Record<string, string>,
    terminalName = 'xterm-256color',
  } = opts;

  const raw = nodePty.spawn(file, args, {
    name: terminalName,
    cols,
    rows,
    cwd,
    env,
  });

  return {
    raw,

    write(data: string): void {
      raw.write(data);
    },

    onData(listener: (data: string) => void): IDisposable {
      return raw.onData(listener);
    },

    resize(newCols: number, newRows: number): void {
      if (!Number.isInteger(newCols) || newCols < 1) {
        throw new RangeError(`pty.resize: cols must be a positive integer, got ${newCols}`);
      }
      if (!Number.isInteger(newRows) || newRows < 1) {
        throw new RangeError(`pty.resize: rows must be a positive integer, got ${newRows}`);
      }
      raw.resize(newCols, newRows);
    },

    kill(signal?: string): void {
      if (os.platform() === 'win32') {
        // node-pty on Windows does not support signal strings; always
        // call kill() without arguments to avoid a runtime error.
        raw.kill();
      } else {
        raw.kill(signal);
      }
    },

    onExit(listener: (event: ExitEvent) => void): IDisposable {
      return raw.onExit(listener);
    },
  };
}
