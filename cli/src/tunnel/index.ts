/**
 * cli/src/tunnel/index.ts
 *
 * Factory that constructs the shipped {@link TunnelBackend}: Microsoft Dev
 * Tunnels. Discovers the official helper and runs the cached-login flow before
 * constructing {@link DevTunnelsBackend}.
 */

import { prepareDevTunnelsBackend, type DevTunnelsProvider } from './devtunnels.js';
import type { TunnelBackend } from './types.js';

export type { TunnelBackend, TunnelConnection } from './types.js';

export interface TunnelBackendOptions {
  readonly devtunnelsProvider?: DevTunnelsProvider;
  readonly verbose?: boolean;
}

/** Create the Dev Tunnels {@link TunnelBackend}. */
export async function createTunnelBackend(
  options: TunnelBackendOptions = {},
): Promise<TunnelBackend> {
  return prepareDevTunnelsBackend({
    provider: options.devtunnelsProvider,
    verbose: options.verbose,
  });
}
