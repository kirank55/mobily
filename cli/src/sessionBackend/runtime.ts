import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { spawn, type PtyProcess, type SpawnOptions } from '../pty.js';

export interface SessionRuntime {
  spawnPty(options: SpawnOptions): PtyProcess;
  execFile(file: string, args: string[]): string;
  canonicalize(path: string): string;
}

export const defaultSessionRuntime: SessionRuntime = {
  spawnPty: spawn,
  execFile(file, args) {
    return execFileSync(file, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  },
  canonicalize: realpathSync,
};
