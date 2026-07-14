/**
 * cli/src/tunnel/index.ts
 *
 * Factory that maps the `--tunnel` CLI flag to a {@link TunnelBackend}
 * instance. `local` is an explicit plaintext development mode; `devtunnels` runs the
 * official helper discovery and cached-login flow before constructing
 * {@link DevTunnelsBackend}.
 */

import { LocalBackend } from './local.js';
import { prepareDevTunnelsBackend, type DevTunnelsProvider } from './devtunnels.js';
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
 * - `'local'`: {@link LocalBackend} — plaintext LAN development mode.
 * - `'devtunnels'`: discovers Microsoft's helper, guides login when needed,
 *   then returns a {@link DevTunnelsBackend}.
 */
export interface TunnelBackendOptions {
  readonly devtunnelsProvider?: DevTunnelsProvider;
  readonly verbose?: boolean;
}

export async function createTunnelBackend(
  tunnel: TunnelId,
  options: TunnelBackendOptions = {},
): Promise<TunnelBackend> {
  switch (tunnel) {
    case 'local':
      return new LocalBackend();

    case 'devtunnels': {
      return prepareDevTunnelsBackend({
        provider: options.devtunnelsProvider,
        verbose: options.verbose,
      });
    }

    default: {
      const _exhaustive: never = tunnel;
      throw new Error(`Unknown tunnel backend: ${_exhaustive as string}`);
    }
  }
}
