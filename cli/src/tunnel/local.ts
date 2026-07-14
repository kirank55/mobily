/**
 * cli/src/tunnel/local.ts
 *
 * LAN {@link TunnelBackend}. Binds the Station server to all
 * interfaces (`0.0.0.0`) and exposes it on the LAN at
 * `wss://<lan-ip>:<port>` by default. No account, relay, or external service — the
 * phone and the Station must be on the same network. Device Key auth (Phase 2)
 * still gates access.
 */

import * as os from 'node:os';
import type { TunnelBackend, TunnelConnection } from './types.js';
import type { LocalTlsIdentity } from '../localTls.js';

/** LocalBackend — pinned TLS on LAN, or explicit plaintext development mode. */
export class LocalBackend implements TunnelBackend {
  readonly id = 'local';
  readonly bindHost = '0.0.0.0';

  constructor(readonly serverTls?: LocalTlsIdentity) {}

  connect(localPort: number): Promise<TunnelConnection> {
    const ip = primaryLanIp();
    const host = ip ?? 'localhost';
    return Promise.resolve({
      url: `${this.serverTls ? 'wss' : 'ws'}://${host}:${localPort}`,
      certificatePin: this.serverTls?.certificatePin,
      disconnect: () => Promise.resolve(),
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return the first non-internal IPv4 address from the system's network
 * interfaces — the most likely candidate for a LAN-reachable address. Returns
 * `undefined` if none is found (e.g. no active network connection).
 */
export function primaryLanIp(): string | undefined {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const nets = interfaces[name];
    if (!nets) continue;
    for (const net of nets) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return undefined;
}
