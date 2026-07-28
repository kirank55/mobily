import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { loadOrCreateStationIdentity, stationFingerprint } from '../src/stationIdentity.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('stationFingerprint()', () => {
  it('formats the first digest bytes as grouped uppercase hex', () => {
    // SHA-256 of 32 zero bytes is 66687aadf862bd77…
    expect(stationFingerprint(Buffer.alloc(32, 0))).toBe('SHA256:6668-7AAD-F862-BD77');
  });
});

describe('loadOrCreateStationIdentity()', () => {
  it('creates a persisted identity once and reloads it on later runs', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'mobily-identity-'));
    temporaryDirectories.push(directory);
    const file = path.join(directory, 'state', 'station-identity');

    const identity = loadOrCreateStationIdentity(file);
    expect(identity).toHaveLength(32);
    if (process.platform !== 'win32') {
      expect(statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }

    expect(loadOrCreateStationIdentity(file)).toEqual(identity);
    expect(readFileSync(file, 'utf8').trim()).toBe(identity.toString('base64'));
  });

  it('regenerates the identity when the persisted file is unreadable', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'mobily-identity-'));
    temporaryDirectories.push(directory);
    const file = path.join(directory, 'station-identity');
    writeFileSync(file, 'not-a-valid-identity', { mode: 0o600 });

    const identity = loadOrCreateStationIdentity(file);
    expect(identity).toHaveLength(32);
    expect(loadOrCreateStationIdentity(file)).toEqual(identity);
  });
});
