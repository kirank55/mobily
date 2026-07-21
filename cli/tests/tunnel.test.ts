/**
 * cli/tests/tunnel.test.ts
 *
 * Unit tests for LocalBackend — the default TunnelBackend (ADR 0003). Verifies
 * the bind host, the connection URL shape, LAN IP detection, and that
 * disconnect is a safe no-op.
 */

import * as os from 'node:os';
import { describe, expect, it } from 'vitest';
import { LocalBackend, primaryLanIp } from '../src/tunnel/local.js';
import { createTunnelBackend, isTunnelId } from '../src/tunnel/index.js';
import type { TunnelBackend } from '../src/tunnel/types.js';

describe('LocalBackend', () => {
  const backend: TunnelBackend = new LocalBackend();

  it('has id "local"', () => {
    expect(backend.id).toBe('local');
  });

  it('binds to 0.0.0.0 so the WS server is reachable on the LAN', () => {
    expect(backend.bindHost).toBe('0.0.0.0');
  });

  it('connect() returns a ws:// URL containing the local port', async () => {
    const conn = await backend.connect(12345);
    expect(conn.url).toMatch(/^ws:\/\/[^:]+:12345$/);
  });

  it('returns WSS and its certificate pin when a TLS identity is configured', async () => {
    const secure = new LocalBackend({
      key: 'key',
      cert: 'cert',
      certificatePin: 'sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    });
    const connection = await secure.connect(12345);
    expect(connection.url).toMatch(/^wss:\/\/[^:]+:12345$/);
    expect(connection.certificatePin).toBe(secure.serverTls?.certificatePin);
  });

  it('connect() URL uses localhost for plaintext and LAN IP for TLS', async () => {
    const plaintext = await backend.connect(8080);
    expect(plaintext.url).toBe('ws://localhost:8080');

    const secure = new LocalBackend({
      key: 'key',
      cert: 'cert',
      certificatePin: 'sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    });
    const ip = primaryLanIp();
    const expectedHost = ip ?? 'localhost';
    const connection = await secure.connect(8080);
    expect(connection.url).toBe(`wss://${expectedHost}:8080`);
  });

  it('disconnect() resolves without error', async () => {
    const conn = await backend.connect(9999);
    await expect(conn.disconnect()).resolves.toBeUndefined();
  });

  it('disconnect() is safe to call multiple times', async () => {
    const conn = await backend.connect(9999);
    await conn.disconnect();
    await expect(conn.disconnect()).resolves.toBeUndefined();
  });
});

describe('primaryLanIp()', () => {
  it('returns an IPv4 string or undefined', () => {
    const ip = primaryLanIp();
    if (ip !== undefined) {
      expect(typeof ip).toBe('string');
      // IPv4 addresses contain exactly three dots.
      expect(ip.split('.')).toHaveLength(4);
    }
  });

  it('never returns an internal/loopback address', () => {
    const ip = primaryLanIp();
    if (ip !== undefined) {
      expect(ip).not.toBe('127.0.0.1');
      expect(ip).not.toBe('0.0.0.0');
    }
  });

  it('matches an address present in os.networkInterfaces()', () => {
    const ip = primaryLanIp();
    if (ip === undefined) return; // No network — skip.

    const allAddresses: string[] = [];
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      const nets = interfaces[name];
      if (!nets) continue;
      for (const net of nets) {
        allAddresses.push(net.address);
      }
    }
    expect(allAddresses).toContain(ip);
  });
});

describe('isTunnelId()', () => {
  it('accepts "local" and "devtunnels"', () => {
    expect(isTunnelId('local')).toBe(true);
    expect(isTunnelId('devtunnels')).toBe(true);
  });

  it('rejects unknown values', () => {
    expect(isTunnelId('bore')).toBe(false);
    expect(isTunnelId('')).toBe(false);
    expect(isTunnelId('ssh')).toBe(false);
  });
});

describe('createTunnelBackend()', () => {
  it("returns a LocalBackend for 'local'", async () => {
    const backend = await createTunnelBackend('local', { allowInsecureLocal: true });
    expect(backend.id).toBe('local');
    expect(backend.bindHost).toBe('0.0.0.0');
  });
});
