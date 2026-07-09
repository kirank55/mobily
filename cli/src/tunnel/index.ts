/**
 * cli/src/tunnel/index.ts
 *
 * Factory that maps the `--tunnel` CLI flag to a {@link TunnelBackend}
 * instance. `local` (the default) needs no setup; `devtunnels` runs the
 * device-code auth flow before constructing {@link DevTunnelsBackend}.
 */

import { LocalBackend } from './local.js';
import { DevTunnelsBackend } from './devtunnels.js';
import { loadDevTunnelsConfig, isDevTunnelsConfigured } from './config.js';
import { authenticate } from './device-code.js';
import type { TunnelBackend } from './types.js';

export type { TunnelBackend, TunnelConnection } from './types.js';

const TUNNEL_IDS = ['local', 'devtunnels'] as const;
export type TunnelId = (typeof TUNNEL_IDS)[number];

/** Type guard: is the string a valid tunnel identifier? */
export function isTunnelId(value: string): value is TunnelId {
  return (TUNNEL_IDS as readonly string[]).includes(value);
}

/**
 * Create a {@link TunnelBackend} for the given tunnel id.
 *
 * - `'local'` (default): {@link LocalBackend} — LAN, zero setup.
 * - `'devtunnels'`: runs the device-code auth flow, then returns a
 *   {@link DevTunnelsBackend}. Requires a configured client ID.
 */
export async function createTunnelBackend(tunnel: TunnelId): Promise<TunnelBackend> {
  switch (tunnel) {
    case 'local':
      return new LocalBackend();

    case 'devtunnels': {
      const config = loadDevTunnelsConfig();
      if (!isDevTunnelsConfigured(config)) {
        throw new Error(
          'Dev Tunnels is not configured. Set MOBILY_DEVTUNNELS_CLIENT_ID or ' +
            'see docs/devtunnels-provisioning.md.',
        );
      }
      const auth = await authenticate(config.clientId, config.tenantId);
      return new DevTunnelsBackend(auth.token);
    }

    default: {
      const _exhaustive: never = tunnel;
      throw new Error(`Unknown tunnel backend: ${_exhaustive as string}`);
    }
  }
}
