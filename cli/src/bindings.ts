import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseDeviceBindingId, type DeviceBindingId } from '@mobily/shared';

export interface StoredDeviceBinding {
  readonly deviceBindingId: DeviceBindingId;
  readonly publicKey: string;
  readonly stationName: string;
  readonly pairedAt: Date;
}

export interface BindingRepository {
  get(deviceBindingId: string): StoredDeviceBinding | undefined;
  list(): StoredDeviceBinding[];
  save(binding: StoredDeviceBinding): void;
  revoke(deviceBindingId: string): boolean;
}

export class MemoryBindingRepository implements BindingRepository {
  private readonly bindings = new Map<string, StoredDeviceBinding>();

  get(deviceBindingId: string): StoredDeviceBinding | undefined {
    return this.bindings.get(deviceBindingId);
  }

  list(): StoredDeviceBinding[] {
    return [...this.bindings.values()];
  }

  save(binding: StoredDeviceBinding): void {
    this.bindings.set(binding.deviceBindingId, binding);
  }

  revoke(deviceBindingId: string): boolean {
    return this.bindings.delete(deviceBindingId);
  }
}

export class FileBindingRepository implements BindingRepository {
  private readonly bindings = new Map<string, StoredDeviceBinding>();

  constructor(private readonly filePath: string) {
    this.load();
  }

  get(deviceBindingId: string): StoredDeviceBinding | undefined {
    return this.bindings.get(deviceBindingId);
  }

  list(): StoredDeviceBinding[] {
    return [...this.bindings.values()].sort(
      (left, right) => left.pairedAt.getTime() - right.pairedAt.getTime(),
    );
  }

  save(binding: StoredDeviceBinding): void {
    const previous = this.bindings.get(binding.deviceBindingId);
    this.bindings.set(binding.deviceBindingId, binding);
    try {
      this.persist();
    } catch (error) {
      if (previous) this.bindings.set(binding.deviceBindingId, previous);
      else this.bindings.delete(binding.deviceBindingId);
      throw error;
    }
  }

  revoke(deviceBindingId: string): boolean {
    const previous = this.bindings.get(deviceBindingId);
    const deleted = this.bindings.delete(deviceBindingId);
    if (deleted) {
      try {
        this.persist();
      } catch (error) {
        if (previous) this.bindings.set(deviceBindingId, previous);
        throw error;
      }
    }
    return deleted;
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown;
      if (!Array.isArray(parsed)) throw new TypeError('expected an array');
      for (const value of parsed) {
        const binding = parseStoredBinding(value);
        if (!binding) throw new TypeError('invalid binding');
        this.bindings.set(binding.deviceBindingId, binding);
      }
      chmodSync(this.filePath, 0o600);
    } catch (error) {
      throw new Error(
        `Cannot read Device Key bindings from ${this.filePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private persist(): void {
    const directory = path.dirname(this.filePath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    const temporaryPath = path.join(
      directory,
      `.${path.basename(this.filePath)}.${process.pid}.tmp`,
    );
    const serialized = this.list().map((binding) => ({
      ...binding,
      pairedAt: binding.pairedAt.toISOString(),
    }));
    writeFileSync(temporaryPath, `${JSON.stringify(serialized, null, 2)}\n`, { mode: 0o600 });
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, this.filePath);
    chmodSync(this.filePath, 0o600);
  }
}

export function defaultBindingFile(homeDirectory = os.homedir()): string {
  return path.join(homeDirectory, '.mobily', 'device-bindings.json');
}

function parseStoredBinding(value: unknown): StoredDeviceBinding | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const deviceBindingId = parseDeviceBindingId(item['deviceBindingId']);
  const pairedAt = typeof item['pairedAt'] === 'string' ? new Date(item['pairedAt']) : null;
  if (
    !deviceBindingId ||
    typeof item['publicKey'] !== 'string' ||
    item['publicKey'].length === 0 ||
    typeof item['stationName'] !== 'string' ||
    item['stationName'].length === 0 ||
    !pairedAt ||
    !Number.isFinite(pairedAt.getTime())
  ) {
    return null;
  }
  return {
    deviceBindingId,
    publicKey: item['publicKey'],
    stationName: item['stationName'],
    pairedAt,
  };
}
