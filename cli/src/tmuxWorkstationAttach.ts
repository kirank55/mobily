import { spawn as defaultSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { MOBILY_CLI_PID_ENV, type SessionBackend } from './mux/types.js';
import { defaultSessionRuntime, type SessionRuntime } from './mux/runtime.js';
import { clearShellPane, printShellPaneLines, resizePairingPanelLines } from './mux/tmux.js';
import type { IDisposable } from './pty/node-pty.js';
import type { WorkstationInput, WorkstationOutput } from './workstationTerminal.js';

export type SpawnFn = (
  file: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

/** Printed into the shell after phone auth; dismissed by a normal shell `clear`. */
export const CONNECTED_SUCCESS_LINE = 'Connected Successfully';

/** Help/exit hint shown with the success line. */
export const CONNECTED_HELP_LINE = ["'mobily -h' for help ·", "'mobily exit' to exit"].join(' ');

/** Success lines rendered as a dismissible shell banner after phone auth. */
export const CONNECTED_WORKSTATION_LINES = [CONNECTED_SUCCESS_LINE, CONNECTED_HELP_LINE] as const;

/** Joined form of {@link CONNECTED_WORKSTATION_LINES} (e.g. mux panel height fixtures). */
export const CONNECTED_WORKSTATION_PANEL = CONNECTED_WORKSTATION_LINES.join('\n');

export const CONNECTED_WORKSTATION_PANEL_HEIGHT = CONNECTED_WORKSTATION_LINES.length;

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

/**
 * Bring the Station TTY into the Mobily tmux Session after a phone authenticates.
 *
 * Outside an outer tmux client: spawn `tmux attach` with inherited stdio.
 * Inside outer tmux: split the current window 50/50 and attach in the bottom
 * pane with `TMUX` cleared to avoid nesting the outer client.
 *
 * Clears the shell, renders the Connected Successfully banner directly on its
 * TTY (so a later `clear` dismisses it), then attaches. Ctrl+C remains
 * available to interrupt the shared Session. `mobily exit` signals the owning
 * CLI so both direct and outer-tmux attachments exit cleanly.
 */
export function attachTmuxWorkstation(options: AttachTmuxWorkstationOptions): IDisposable {
  const env = options.env ?? process.env;
  const spawn = options.spawn ?? defaultSpawn;
  const runtime = options.runtime ?? defaultSessionRuntime;
  const exitMessage = 'Exiting Mobily';
  let registeredOwner = false;
  try {
    runtime.execFile('tmux', [
      'set-environment',
      '-t',
      options.sessionName,
      MOBILY_CLI_PID_ENV,
      String(process.pid),
    ]);
    registeredOwner = true;
  } catch {
    // `mobily exit` registration is best-effort; attach still proceeds.
  }
  try {
    // No-op when the QR/status pane was already hidden on auth.
    resizePairingPanelLines(options.sessionName, CONNECTED_WORKSTATION_PANEL_HEIGHT, runtime);
  } catch {
    // Status-pane clamp is best-effort; attach still proceeds.
  }
  try {
    clearShellPane(options.sessionName, runtime);
  } catch {
    // Shell clear is best-effort; attach still proceeds.
  }
  try {
    printShellPaneLines(options.sessionName, CONNECTED_WORKSTATION_LINES, runtime);
  } catch {
    // Success banner is best-effort; attach still proceeds.
  }

  const attachment =
    env.TMUX != null && env.TMUX !== ''
      ? attachViaOuterSplit(options, runtime)
      : attachViaStdioInherit(options, spawn, env, exitMessage);

  return {
    dispose(): void {
      attachment.dispose();
      if (registeredOwner) {
        try {
          runtime.execFile('tmux', [
            'set-environment',
            '-u',
            '-t',
            options.sessionName,
            MOBILY_CLI_PID_ENV,
          ]);
        } catch {
          // The Session may already have ended.
        }
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
