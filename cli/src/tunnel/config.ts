/**
 * cli/src/tunnel/config.ts
 *
 * Loads Dev Tunnels provisioning config — the Entra ID app registration client
 * ID and tenant ID needed for the device-code auth flow.
 *
 * The maintainer registers the app once (see `docs/devtunnels-provisioning.md`)
 * and the client ID ships with the CLI — either baked in as a `DEFAULT_CLIENT_ID`
 * constant or overridden via the `MOBILY_DEVTUNNELS_CLIENT_ID` env var.
 *
 * Used by `DevTunnelsBackend` (Phase 2, branch 2). Not needed for `LocalBackend`.
 */

/** Dev Tunnels provisioning configuration. */
export interface DevTunnelsConfig {
  /** Entra ID app registration (application) client ID. */
  readonly clientId: string;
  /** Entra ID tenant ID. Use `'common'` for multi-tenant. */
  readonly tenantId: string;
}

const ENV_CLIENT_ID = 'MOBILY_DEVTUNNELS_CLIENT_ID';
const ENV_TENANT_ID = 'MOBILY_DEVTUNNELS_TENANT_ID';

/** Default tenant — accepts any Microsoft Entra ID or personal Microsoft account. */
const DEFAULT_TENANT_ID = 'common';

/**
 * Baked-in default client ID — populated after the maintainer follows the
 * provisioning runbook (`docs/devtunnels-provisioning.md`). Empty string until
 * then; `isDevTunnelsConfigured()` returns `false` in that state.
 */
const DEFAULT_CLIENT_ID = '';

/** Load Dev Tunnels config from env vars, falling back to baked-in defaults. */
export function loadDevTunnelsConfig(): DevTunnelsConfig {
  const clientId = process.env[ENV_CLIENT_ID] ?? DEFAULT_CLIENT_ID;
  const tenantId = process.env[ENV_TENANT_ID] ?? DEFAULT_TENANT_ID;
  return { clientId, tenantId };
}

/** Whether a Dev Tunnels client ID has been configured (baked in or via env). */
export function isDevTunnelsConfigured(
  config: DevTunnelsConfig = loadDevTunnelsConfig(),
): boolean {
  return config.clientId.length > 0;
}
