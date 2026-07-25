/**
 * cli/src/tunnel/local.ts
 *
 * LAN {@link TunnelBackend}. Binds the Station server to all
 * interfaces (`0.0.0.0`) and exposes it on the LAN at
 * `wss://<lan-ip>:<port>` by default. Plaintext `--allow-insecure-local` advertises
 * `ws://localhost:<port>` for same-machine browser / Expo web clients (Android
 * refuses insecure transport). No account, relay, or external service — the
 * phone and the Station must be on the same network for pinned TLS. Device Key auth (Phase 2)
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
    // Insecure plaintext is browser/smoke-only (Android refuses ws://). Advertise
    // localhost so Expo web and smoke.html on the same machine can connect.
    // MOBILY_LOCAL_ADVERTISE_HOST helps WSL/USB setups where the WSL eth0 IP is
    // not reachable from the phone (advertise the Windows LAN IP + portproxy).
    const host = this.serverTls
      ? (process.env.MOBILY_LOCAL_ADVERTISE_HOST ?? primaryLanIp() ?? 'localhost')
      : 'localhost';
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
