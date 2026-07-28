import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { FileBindingRepository } from '../src/bindings.js';
import { parseDeviceBindingId, type DeviceBindingId } from '@mobily/shared';

const temporaryDirectories: string[] = [];
const bindingId = parseDeviceBindingId('binding_AAAAAAAAAAAAAAAAAAAAAA')!;
const otherBindingId = parseDeviceBindingId('binding_BBBBBBBBBBBBBBBBBBBBBB')!;

function storedBinding(deviceBindingId: DeviceBindingId) {
  return {
    deviceBindingId,
    publicKey: 'public-key',
    stationName: 'test-station',
    pairedAt: new Date('2026-01-02T03:04:05.000Z'),
  };
}

/** Rewrite the bindings file the way another mobily process would. */
function writeBindingsFileExternally(
  file: string,
  bindings: Array<{ pairedAt: Date }>,
  mtime: Date,
): void {
  const serialized = bindings.map((binding) => ({
    ...binding,
    pairedAt: binding.pairedAt.toISOString(),
  }));
  writeFileSync(file, `${JSON.stringify(serialized, null, 2)}\n`, { mode: 0o600 });
  utimesSync(file, mtime, mtime);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('FileBindingRepository', () => {
  it('persists Device Key bindings with restrictive permissions and reloads them', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'mobily-bindings-'));
    temporaryDirectories.push(directory);
    const file = path.join(directory, 'state', 'device-bindings.json');
    const repository = new FileBindingRepository(file);

    repository.save({
      deviceBindingId: bindingId,
      publicKey: 'public-key',
      stationName: 'test-station',
      pairedAt: new Date('2026-01-02T03:04:05.000Z'),
    });

    expect(new FileBindingRepository(file).list()).toEqual([
      {
        deviceBindingId: bindingId,
        publicKey: 'public-key',
        stationName: 'test-station',
        pairedAt: new Date('2026-01-02T03:04:05.000Z'),
      },
    ]);
    if (process.platform !== 'win32') {
      expect(statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
    expect(readFileSync(file, 'utf8')).not.toContain('private');
  });

  it('lists and revokes a persisted binding', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'mobily-bindings-'));
    temporaryDirectories.push(directory);
    const repository = new FileBindingRepository(path.join(directory, 'bindings.json'));
    repository.save({
      deviceBindingId: bindingId,
      publicKey: 'public-key',
      stationName: 'test-station',
      pairedAt: new Date('2026-01-02T03:04:05.000Z'),
    });

    expect(repository.revoke('binding_AAAAAAAAAAAAAAAAAAAAAA')).toBe(true);
    expect(repository.revoke('binding_AAAAAAAAAAAAAAAAAAAAAA')).toBe(false);
    expect(repository.list()).toEqual([]);
  });

  it('fails closed when the persisted file is malformed', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'mobily-bindings-'));
    temporaryDirectories.push(directory);
    const file = path.join(directory, 'bindings.json');
    const repository = new FileBindingRepository(file);
    repository.save({
      deviceBindingId: bindingId,
      publicKey: 'public-key',
      stationName: 'test-station',
      pairedAt: new Date('2026-01-02T03:04:05.000Z'),
    });
    // A malformed replacement must never silently become an empty trusted store.
    writeFileSync(file, '{', { mode: 0o600 });

    expect(() => new FileBindingRepository(file)).toThrow('Cannot read Device Key bindings');
  });

  it('observes revocations made by another process', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'mobily-bindings-'));
    temporaryDirectories.push(directory);
    const file = path.join(directory, 'bindings.json');
    const station = new FileBindingRepository(file);
    station.save(storedBinding(bindingId));
    station.save(storedBinding(otherBindingId));

    writeBindingsFileExternally(file, [storedBinding(otherBindingId)], new Date('2027-01-01'));

    expect(station.get(bindingId)).toBeUndefined();
    expect(station.list().map((binding) => binding.deviceBindingId)).toEqual([otherBindingId]);
  });

  it('observes pairings made by another process', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'mobily-bindings-'));
    temporaryDirectories.push(directory);
    const file = path.join(directory, 'bindings.json');
    const station = new FileBindingRepository(file);
    expect(station.list()).toEqual([]);

    writeBindingsFileExternally(file, [storedBinding(bindingId)], new Date('2027-01-01'));

    expect(station.get(bindingId)?.publicKey).toBe('public-key');
  });

  it('merges external changes instead of clobbering them on save', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'mobily-bindings-'));
    temporaryDirectories.push(directory);
    const file = path.join(directory, 'bindings.json');
    writeBindingsFileExternally(file, [storedBinding(bindingId)], new Date('2026-06-01'));
    const station = new FileBindingRepository(file);

    writeBindingsFileExternally(
      file,
      [storedBinding(bindingId), storedBinding(otherBindingId)],
      new Date('2027-01-01'),
    );
    station.save(storedBinding(parseDeviceBindingId('binding_CCCCCCCCCCCCCCCCCCCCCC')!));

    expect(
      new FileBindingRepository(file).list().map((binding) => binding.deviceBindingId),
    ).toEqual([bindingId, otherBindingId, 'binding_CCCCCCCCCCCCCCCCCCCCCC']);
  });

  it('keeps last-known-good state when an external write is malformed', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'mobily-bindings-'));
    temporaryDirectories.push(directory);
    const file = path.join(directory, 'bindings.json');
    const station = new FileBindingRepository(file);
    station.save(storedBinding(bindingId));

    writeFileSync(file, '{', { mode: 0o600 });
    utimesSync(file, new Date('2027-01-01'), new Date('2027-01-01'));

    expect(station.get(bindingId)?.publicKey).toBe('public-key');
  });

  it('treats a deleted bindings file as having no bindings', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'mobily-bindings-'));
    temporaryDirectories.push(directory);
    const file = path.join(directory, 'bindings.json');
    const station = new FileBindingRepository(file);
    station.save(storedBinding(bindingId));

    rmSync(file);

    expect(station.get(bindingId)).toBeUndefined();
    expect(station.list()).toEqual([]);
  });
});
