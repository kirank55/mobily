import type { SpawnOptions } from '../pty.js';
import { BareBackend } from './bare.js';
import { defaultSessionRuntime, type SessionRuntime } from './runtime.js';
import { TmuxBackend } from './tmux.js';
import type { SessionBackend } from './types.js';
import { defaultSessionName, isTmuxAvailable, validateSessionName } from './cliVerbs.js';

export type { SessionRuntime } from './runtime.js';
export {
  defaultSessionName,
  exitCurrentMobily,
  hideCurrentQrPanel,
  isTmuxAvailable,
  killTmuxSession,
  validateSessionName,
} from './cliVerbs.js';

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
