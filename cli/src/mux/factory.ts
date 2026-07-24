import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import type { SpawnOptions } from '../pty/node-pty.js';
import { BareBackend } from './bare.js';
import { defaultSessionRuntime, type SessionRuntime } from './runtime.js';
import { removePairingPanel, TmuxBackend } from './tmux.js';
import { MOBILY_CLI_PID_ENV, type SessionBackend } from './types.js';

const SESSION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export type { SessionRuntime } from './runtime.js';

export interface SessionBackendOptions extends SpawnOptions {
  sessionName?: string;
  scrollbackBytes?: number;
}

export function createSessionBackend(
  options: SessionBackendOptions = {},
  runtime: SessionRuntime = defaultSessionRuntime,
): SessionBackend {
  const cwd = options.cwd ?? process.cwd();
  if (!isTmuxAvailable(runtime)) return new BareBackend(options, runtime);
  const sessionName = options.sessionName
    ? validateSessionName(options.sessionName)
    : defaultSessionName(cwd, runtime.canonicalize);
  return new TmuxBackend({ ...options, cwd, sessionName }, runtime);
}

export function isTmuxAvailable(runtime: SessionRuntime = defaultSessionRuntime): boolean {
  try {
    runtime.execFile('tmux', ['-V']);
    return true;
  } catch {
    return false;
  }
}

export function defaultSessionName(
  cwd: string,
  canonicalize: (path: string) => string = defaultSessionRuntime.canonicalize,
): string {
  const canonical = canonicalize(cwd);
  const slug =
    basename(canonical)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'session';
  const hash = createHash('sha256').update(canonical).digest('hex').slice(0, 8);
  return `mobily-${slug}-${hash}`;
}

export function validateSessionName(name: string): string {
  if (!SESSION_NAME_PATTERN.test(name)) {
    throw new TypeError(
      'Session name must start with a letter or number and contain at most 64 letters, numbers, _ or - characters',
    );
  }
  return name;
}

export function killTmuxSession(
  name: string,
  runtime: SessionRuntime = defaultSessionRuntime,
): void {
  runtime.execFile('tmux', ['kill-session', '-t', validateSessionName(name)]);
}

type SignalProcess = (pid: number, signal: NodeJS.Signals) => boolean;

/** Ask the Mobily CLI that owns the current tmux Session to shut down. */
export function exitCurrentMobily(
  runtime: SessionRuntime = defaultSessionRuntime,
  signalProcess: SignalProcess = process.kill,
): boolean {
  try {
    const owner = runtime.execFile('tmux', ['show-environment', MOBILY_CLI_PID_ENV]).trim();
    const match = owner.match(new RegExp(`^${MOBILY_CLI_PID_ENV}=(\\d+)$`));
    if (!match) return false;
    const pid = Number(match[1]);
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    signalProcess(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

/** Remove the QR pane from the tmux session containing the current shell. */
export function hideCurrentQrPanel(runtime: SessionRuntime = defaultSessionRuntime): boolean {
  let session: string;
  try {
    session = validateSessionName(runtime.execFile('tmux', ['display-message', '-p', '#S']).trim());
  } catch {
    return false;
  }
  return removePairingPanel(session, runtime);
}
