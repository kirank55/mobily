import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { loadOrCreateLocalTlsIdentity } from '../src/localTls.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('local TLS identity', () => {
  it('persists one reusable certificate and SHA-256 SPKI pin', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'mobily-tls-'));
    directories.push(directory);
    const file = path.join(directory, 'state', 'local-tls.json');
    const first = await loadOrCreateLocalTlsIdentity(file);
    const second = await loadOrCreateLocalTlsIdentity(file);

    expect(second).toEqual(first);
    expect(first.certificatePin).toMatch(/^sha256\/[A-Za-z0-9+/]{43}=$/);
    if (process.platform !== 'win32') {
      expect(statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
  });
});
