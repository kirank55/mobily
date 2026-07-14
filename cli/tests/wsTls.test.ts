import https from 'node:https';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { loadOrCreateLocalTlsIdentity } from '../src/localTls.js';
import type { Session } from '../src/session.js';
import { startServer } from '../src/ws.js';

describe('TLS Station server', () => {
  it('serves HTTPS and advertises WSS when given the local identity', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'mobily-wss-'));
    const identity = await loadOrCreateLocalTlsIdentity(path.join(directory, 'tls.json'));
    const session = { attach: vi.fn() } as unknown as Session;
    const server = await startServer({
      host: '127.0.0.1',
      session,
      tls: identity,
      httpRequestHandler: (_request, response) => response.writeHead(204).end(),
    });

    try {
      expect(server.url).toBe(`wss://127.0.0.1:${server.port}`);
      const status = await new Promise<number | undefined>((resolve, reject) => {
        https
          .get(
            { hostname: '127.0.0.1', port: server.port, rejectUnauthorized: false },
            (response) => resolve(response.statusCode),
          )
          .on('error', reject);
      });
      expect(status).toBe(204);
    } finally {
      await server.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
