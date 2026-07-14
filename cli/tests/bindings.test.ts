import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { FileBindingRepository } from '../src/bindings.js';
import { parseDeviceBindingId } from '@mobily/shared';

const temporaryDirectories: string[] = [];
const bindingId = parseDeviceBindingId('binding_AAAAAAAAAAAAAAAAAAAAAA')!;

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
});
