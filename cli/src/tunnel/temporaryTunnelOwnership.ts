import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type TemporaryTunnelLifecycleState = 'creating' | 'ready' | 'deleting';

export interface TemporaryTunnelOwnership {
  readonly version: 1;
  readonly tunnelId: string;
  readonly ownerRunId: string;
  readonly ownerProcessId?: number;
  readonly createdAt: string;
  readonly state: TemporaryTunnelLifecycleState;
}

/**
 * Durable boundary for tunnels Mobily created. Callers must retain and pass the
 * exact ownership identity; the store never discovers or adopts provider
 * resources.
 */
export interface TemporaryTunnelOwnershipStore {
  list(): Promise<readonly TemporaryTunnelOwnership[]>;
  save(ownership: TemporaryTunnelOwnership): Promise<void>;
  remove(ownership: TemporaryTunnelOwnership): Promise<void>;
}

export class FileTemporaryTunnelOwnershipStore implements TemporaryTunnelOwnershipStore {
  constructor(private readonly directory = defaultTemporaryTunnelOwnershipDirectory()) {}

  async list(): Promise<readonly TemporaryTunnelOwnership[]> {
    if (!existsSync(this.directory)) return [];
    return readdirSync(this.directory)
      .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
      .map((name) => {
        const value: unknown = JSON.parse(readFileSync(path.join(this.directory, name), 'utf8'));
        if (!isTemporaryTunnelOwnership(value)) {
          throw new Error(`Invalid Temporary Tunnel ownership record: ${name}`);
        }
        return value;
      });
  }

  async save(ownership: TemporaryTunnelOwnership): Promise<void> {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    chmodSync(this.directory, 0o700);

    const destination = this.recordPath(ownership);
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    let descriptor: number | undefined;
    try {
      descriptor = openSync(temporary, 'wx', 0o600);
      writeFileSync(descriptor, `${JSON.stringify(ownership, null, 2)}\n`, 'utf8');
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporary, destination);
      chmodSync(destination, 0o600);
      syncDirectory(this.directory);
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      rmSync(temporary, { force: true });
      throw error;
    }
  }

  async remove(ownership: TemporaryTunnelOwnership): Promise<void> {
    rmSync(this.recordPath(ownership), { force: true });
    syncDirectory(this.directory);
  }

  private recordPath(ownership: TemporaryTunnelOwnership): string {
    const key = createHash('sha256')
      .update(ownership.ownerRunId)
      .update('\0')
      .update(ownership.tunnelId)
      .digest('hex');
    return path.join(this.directory, `${key}.json`);
  }
}

export function defaultTemporaryTunnelOwnershipDirectory(homeDirectory = os.homedir()): string {
  return path.join(homeDirectory, '.mobily', 'temporary-tunnels');
}

function isTemporaryTunnelOwnership(value: unknown): value is TemporaryTunnelOwnership {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<TemporaryTunnelOwnership>;
  return (
    candidate.version === 1 &&
    typeof candidate.tunnelId === 'string' &&
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(candidate.tunnelId) &&
    typeof candidate.ownerRunId === 'string' &&
    candidate.ownerRunId.length > 0 &&
    (candidate.ownerProcessId === undefined ||
      (Number.isInteger(candidate.ownerProcessId) && candidate.ownerProcessId! > 0)) &&
    typeof candidate.createdAt === 'string' &&
    (candidate.state === 'creating' ||
      candidate.state === 'ready' ||
      candidate.state === 'deleting')
  );
}

function syncDirectory(directory: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(directory, 'r');
    fsyncSync(descriptor);
  } catch {
    // Directory fsync is unavailable on some supported filesystems (notably
    // Windows). Rename/unlink remains atomic there.
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
