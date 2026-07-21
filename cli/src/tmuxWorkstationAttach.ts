import { spawn as defaultSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionBackend } from './mux/types.js';
import { defaultSessionRuntime, type SessionRuntime } from './mux/runtime.js';
import { clearShellPane, resizePairingPanelLines } from './mux/tmux.js';
import type { IDisposable } from './pty/node-pty.js';
import type { WorkstationInput, WorkstationOutput } from './workstationTerminal.js';

export type SpawnFn = (
  file: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

/** Shown briefly in the status header, then removed after {@link CONNECTED_SUCCESS_DISMISS_MS}. */
export const CONNECTED_SUCCESS_LINE = 'Connected Successfully';

/** Help/exit hint shown with the success line; both dismiss together. */
export const CONNECTED_HELP_LINE = [
  'Run mobily -h for help.',
  'Press Ctrl+C twice to exit',
].join(' ');

/** Status shown right after the phone connects; removed entirely after the dismiss delay. */
export const CONNECTED_WORKSTATION_PANEL = [
  CONNECTED_SUCCESS_LINE,
  CONNECTED_HELP_LINE,
].join('\n');

export const CONNECTED_WORKSTATION_PANEL_HEIGHT = 2;

export const CONNECTED_SUCCESS_DISMISS_MS = 10_000;

/** tmux root binding for the double-Ctrl+C exit confirm. */
export const EXIT_KEY_SEQUENCE = 'C-c';

export const EXIT_CONFIRM_WINDOW_SECONDS = 2;

export const EXIT_CONFIRM_MESSAGE = 'Press Ctrl+C again to exit';

/**
 * Shell script installed as `bind-key -n C-c run-shell …`.
 * First press warns; a second press within the confirm window detaches (Node then exits).
 */
export const DOUBLE_CTRL_C_EXIT_SCRIPT = `#!/bin/sh
now=$(date +%s)
last=$(tmux show-environment -g MOBILY_EXIT_AT 2>/dev/null | sed 's/^[^=]*=//')
if [ -n "$last" ] && [ $((now - last)) -le ${EXIT_CONFIRM_WINDOW_SECONDS} ]; then
  tmux set-environment -gu MOBILY_EXIT_AT
  tmux detach-client
else
  tmux set-environment -g MOBILY_EXIT_AT "$now"
  tmux display-message -d 2000 '${EXIT_CONFIRM_MESSAGE.replaceAll("'", "'\\''")}'
fi
`;

export interface AttachTmuxWorkstationOptions {
  sessionName: string;
  attachCommand: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onDetach?: (message: string) => void;
  spawn?: SpawnFn;
  runtime?: SessionRuntime;
}

/** True when this TTY can auto-attach into a tmux-backed Session after phone auth. */
export function shouldAttachTmuxWorkstation(
  backend: Pick<SessionBackend, 'kind' | 'sessionName'>,
  input: Pick<WorkstationInput, 'isTTY'> = process.stdin,
  output: Pick<WorkstationOutput, 'isTTY'> = process.stdout,
): boolean {
  return Boolean(backend.kind === 'tmux' && backend.sessionName && input.isTTY && output.isTTY);
}

/** After a delay, hide the connected status panel (success + help lines). */
export function scheduleConnectedPanelDismiss(options: {
  hidePanel: () => void;
  delayMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}): IDisposable {
  const delayMs = options.delayMs ?? CONNECTED_SUCCESS_DISMISS_MS;
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  const timer = setTimeoutFn(() => {
    options.hidePanel();
  }, delayMs);
  return {
    dispose(): void {
      clearTimeoutFn(timer);
    },
  };
}

/**
 * Bring the Station TTY into the Mobily tmux Session after a phone authenticates.
 *
 * Outside an outer tmux client: spawn `tmux attach` with inherited stdio (status
 * panel on top, shell below). Inside outer tmux: split the current window 50/50 and
 * attach in the bottom pane with `TMUX` cleared to avoid nesting the outer client.
 *
 * Ctrl+C warns once, then detaches on a second press so the CLI can exit gracefully.
 */
export function attachTmuxWorkstation(options: AttachTmuxWorkstationOptions): IDisposable {
  const env = options.env ?? process.env;
  const spawn = options.spawn ?? defaultSpawn;
  const runtime = options.runtime ?? defaultSessionRuntime;
  const exitMessage = 'Exiting Mobily';
  const binding = installDoubleCtrlCExitBinding(runtime);

  try {
    resizePairingPanelLines(options.sessionName, CONNECTED_WORKSTATION_PANEL_HEIGHT, runtime);
  } catch {
    // Status-pane clamp is best-effort; attach still proceeds.
  }
  try {
    clearShellPane(options.sessionName, runtime);
  } catch {
    // Shell clear is best-effort; attach still proceeds.
  }

  const attachment =
    env.TMUX != null && env.TMUX !== ''
      ? attachViaOuterSplit(options, runtime)
      : attachViaStdioInherit(options, spawn, env, exitMessage);

  return {
    dispose(): void {
      attachment.dispose();
      binding.dispose();
    },
  };
}

function installDoubleCtrlCExitBinding(runtime: SessionRuntime): IDisposable {
  let disposed = false;
  let scriptDirectory: string | undefined;
  try {
    scriptDirectory = mkdtempSync(join(tmpdir(), 'mobily-exit-'));
    const scriptPath = join(scriptDirectory, 'ctrl-c-exit.sh');
    writeFileSync(scriptPath, DOUBLE_CTRL_C_EXIT_SCRIPT, { encoding: 'utf8', mode: 0o700 });
    runtime.execFile('tmux', ['bind-key', '-n', EXIT_KEY_SEQUENCE, 'run-shell', scriptPath]);
  } catch {
    // Exit binding is best-effort; attach still proceeds.
    if (scriptDirectory) {
      rmSync(scriptDirectory, { recursive: true, force: true });
      scriptDirectory = undefined;
    }
  }

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      try {
        runtime.execFile('tmux', ['unbind-key', '-n', EXIT_KEY_SEQUENCE]);
        runtime.execFile('tmux', ['set-environment', '-gu', 'MOBILY_EXIT_AT']);
      } catch {
        // Cleanup is best-effort.
      }
      if (scriptDirectory) {
        rmSync(scriptDirectory, { recursive: true, force: true });
      }
    },
  };
}

function attachViaStdioInherit(
  options: AttachTmuxWorkstationOptions,
  spawn: SpawnFn,
  env: NodeJS.ProcessEnv,
  exitMessage: string,
): IDisposable {
  let disposed = false;
  const child = spawn('tmux', ['-T', 'RGB', 'attach-session', '-t', options.sessionName], {
    stdio: 'inherit',
    cwd: options.cwd,
    env,
  });

  const onExit = (): void => {
    if (disposed) return;
    options.onDetach?.(exitMessage);
  };
  child.once('exit', onExit);
  child.once('error', onExit);

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      child.removeListener('exit', onExit);
      child.removeListener('error', onExit);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
      }
    },
  };
}

function attachViaOuterSplit(
  options: AttachTmuxWorkstationOptions,
  runtime: SessionRuntime,
): IDisposable {
  let disposed = false;
  const shellCommand = `TMUX= exec tmux -T RGB attach-session -t ${shellSingleQuote(options.sessionName)}`;
  const args = ['split-window', '-v', '-p', '50', '-P', '-F', '#{pane_id}'];
  if (options.cwd) args.push('-c', options.cwd);
  args.push(shellCommand);
  const pane = runtime.execFile('tmux', args).trim();

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (!pane) return;
      try {
        runtime.execFile('tmux', ['kill-pane', '-t', pane]);
      } catch {
        // Pane may already be gone after the user closed it.
      }
    },
  };
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
