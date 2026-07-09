/**
 * cli/src/tunnel/devtunnels.ts
 *
 * Opt-in remote TunnelBackend (ADR 0003). Creates a Microsoft Dev Tunnel with
 * anonymous connect access, hosts it via the relay, and returns a public
 * `wss://` URL. The operator authenticates once via a device-code flow (see
 * `device-code.ts`); the phone connects without a Microsoft account and proves
 * identity via the Device Key (Phase 2 auth).
 *
 * Uses the official `@microsoft/dev-tunnels-*` SDKs in-process.
 */

import {
  ManagementApiVersions,
  TunnelManagementHttpClient,
} from '@microsoft/dev-tunnels-management';
import type { TunnelRequestOptions } from '@microsoft/dev-tunnels-management';
import {
  TunnelAccessControlEntryType,
  TunnelAccessScopes,
  TunnelEndpoint,
  TunnelProtocol,
} from '@microsoft/dev-tunnels-contracts';
import type { Tunnel } from '@microsoft/dev-tunnels-contracts';
import { TunnelRelayTunnelHost } from '@microsoft/dev-tunnels-connections';
import type { TunnelBackend, TunnelConnection } from './types.js';

/** DevTunnelsBackend — opt-in remote tunnel via Microsoft Dev Tunnels. */
export class DevTunnelsBackend implements TunnelBackend {
  readonly id = 'devtunnels';
  readonly bindHost = 'localhost';

  /**
   * @param accessToken Entra ID access token (audience: Dev Tunnels first-party
   * App ID). Obtained via the device-code flow in `device-code.ts`.
   */
  constructor(private readonly accessToken: string) {}

  async connect(localPort: number): Promise<TunnelConnection> {
    const client = new TunnelManagementHttpClient(
      { name: 'mobily', version: '0.0.0' },
      ManagementApiVersions.Version20230927preview,
      () => Promise.resolve(`Bearer ${this.accessToken}`),
    );

    const options: TunnelRequestOptions = {
      tokenScopes: [TunnelAccessScopes.Host, TunnelAccessScopes.Connect],
      includePorts: true,
    };

    const tunnel: Tunnel = {
      accessControl: {
        entries: [
          {
            type: TunnelAccessControlEntryType.Anonymous,
            subjects: [],
            scopes: [TunnelAccessScopes.Connect],
          },
        ],
      },
      ports: [{ portNumber: localPort, protocol: TunnelProtocol.Http }],
    };

    const created = await client.createTunnel(tunnel, options);

    const host = new TunnelRelayTunnelHost(client);
    await host.connect(created);

    const port = created.ports?.find((p) => p.portNumber === localPort);
    const httpsUrl =
      port?.portForwardingUris?.[0] ??
      created.endpoints?.map((e) => TunnelEndpoint.getPortUri(e, localPort))[0];

    if (!httpsUrl) {
      await host.dispose().catch(() => {});
      await client.deleteTunnel(created).catch(() => {});
      await client.dispose().catch(() => {});
      throw new Error('Dev Tunnels did not return a port URI.');
    }

    const wsUrl = httpsUrl.replace(/^https:\/\//, 'wss://');

    let disposed = false;
    return {
      url: wsUrl,
      disconnect: async () => {
        if (disposed) return;
        disposed = true;
        await host.dispose().catch(() => {});
        await client.deleteTunnel(created).catch(() => {});
        await client.dispose().catch(() => {});
      },
    };
  }
}
