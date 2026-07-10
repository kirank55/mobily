/**
 * cli/src/tunnel/local.ts
 *
 * Development-only {@link TunnelBackend}. Binds the WebSocket server to all
 * interfaces (`0.0.0.0`) and exposes it on the LAN at
 * `ws://<lan-ip>:<port>`. No account, no relay, no external service — the
 * phone and the Station must be on the same network. Device Key auth (Phase 2)
 * still gates access.
 */

import * as os from 'node:os';
import type { TunnelBackend, TunnelConnection } from './types.js';

/** LocalBackend — explicit plaintext LAN mode for isolated development only. */
export class LocalBackend implements TunnelBackend {
  readonly id = 'local';
  readonly bindHost = '0.0.0.0';

  connect(localPort: number): Promise<TunnelConnection> {
    const ip = primaryLanIp();
    const host = ip ?? 'localhost';
    return Promise.resolve({
      url: `ws://${host}:${localPort}`,
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
