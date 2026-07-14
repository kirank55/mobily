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

  it('connect() URL uses a real LAN IPv4 address or localhost fallback', async () => {
    const conn = await backend.connect(8080);
    const ip = primaryLanIp();
    const expectedHost = ip ?? 'localhost';
    expect(conn.url).toBe(`ws://${expectedHost}:8080`);
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
    const backend = await createTunnelBackend('local');
    expect(backend.id).toBe('local');
    expect(backend.bindHost).toBe('0.0.0.0');
  });

});
