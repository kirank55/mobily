# Dev Tunnels TypeScript SDK — research

> Historical research. Mobily no longer embeds these SDK packages or owns the
> OAuth device-code flow. The current implementation orchestrates Microsoft's
> official `devtunnel` helper; see
> [`devtunnels-provisioning.md`](devtunnels-provisioning.md).

Reference for implementing `DevTunnelsBackend` (`cli/src/tunnel/devtunnels.ts`) against
the official `@microsoft/dev-tunnels-*` npm packages, embedded in-process. The flow:
authenticate (device-code) → create a tunnel → enable anonymous *connect* → add a port →
host (connect to the relay) → read the public URL → disconnect/delete.

Companion to [`devtunnels-provisioning.md`](./devtunnels-provisioning.md) and
[ADR 0003](./adr/0003-pluggable-tunnel-backend.md). The `TunnelBackend` /
`TunnelConnection` interface this maps onto lives in `cli/src/tunnel/types.ts`.

All claims below are cited to the Microsoft `dev-tunnels` repo (`main` branch) or the npm
registry, fetched 2026-07-09.

---

## 1. npm packages & versions

Latest stable (all three are versioned in lockstep):

| Package | Version | Role |
|---|---|---|
| `@microsoft/dev-tunnels-contracts` | **1.3.50** | Data contracts (`Tunnel`, `TunnelPort`, enums) |
| `@microsoft/dev-tunnels-management` | **1.3.50** | REST management client (create/list/delete tunnel + ports) |
| `@microsoft/dev-tunnels-connections` | **1.3.50** | Relay host/client (`TunnelRelayTunnelHost`) |

`connections` declares **peer dependencies** that must also be installed (see gotchas):

```
@microsoft/dev-tunnels-ssh     ^3.12.29
@microsoft/dev-tunnels-ssh-tcp ^3.12.29
```

`management` depends on `contracts@1.3.50` and `axios ^1.8.4`; `connections` depends on
`management`, `contracts`, `websocket ^1.0.28`, `vscode-jsonrpc ^4.0.0`.

Sources:
- npm registry `/latest` manifests for each package (version + dependencies/peerDependencies).
- Sample `samples/ts/host/package.json` pins `^1.3.6` for all three — the SDK API is
  stable across the 1.3.x line, so `^1.3.50` is safe.

Install (pnpm workspace — peer deps must be explicit):

```sh
pnpm --filter mobily add @microsoft/dev-tunnels-management@^1.3.50 \
  @microsoft/dev-tunnels-connections@^1.3.50 \
  @microsoft/dev-tunnels-contracts@^1.3.50 \
  @microsoft/dev-tunnels-ssh@^3.12.29 \
  @microsoft/dev-tunnels-ssh-tcp@^3.12.29
```

---

## 2. Exact imports

From the official host sample
([`samples/ts/host/index.ts`](https://github.com/microsoft/dev-tunnels/blob/main/samples/ts/host/index.ts))
and the package barrel exports
([`ts/src/management/index.ts`](https://github.com/microsoft/dev-tunnels/blob/main/ts/src/management/index.ts),
[`ts/src/connections/index.ts`](https://github.com/microsoft/dev-tunnels/blob/main/ts/src/connections/index.ts)):

```ts
import {
  ManagementApiVersions,
  ProductHeaderValue,
  TunnelManagementHttpClient,
  TunnelAuthenticationSchemes,
} from '@microsoft/dev-tunnels-management';
import type { TunnelManagementClient, TunnelRequestOptions } from '@microsoft/dev-tunnels-management';

import {
  Tunnel,
  TunnelPort,
  TunnelAccessControlEntryType,
  TunnelAccessScopes,
  TunnelEndpoint,
  TunnelProtocol,
} from '@microsoft/dev-tunnels-contracts';
import type { TunnelAccessControl } from '@microsoft/dev-tunnels-contracts';

import { TunnelRelayTunnelHost } from '@microsoft/dev-tunnels-connections';
import type { TunnelHost } from '@microsoft/dev-tunnels-connections';
```

> ESM/CJS note: the CLI is ESM (`"type": "module"`, tsup `esm`, `module: NodeNext`); the
> dev-tunnels packages are CommonJS (`"main": "./index.js"`, no `exports` field). tsup/esbuild
> resolves the interop at **build** time, so runtime `import` is fine. Under `tsc --noEmit`,
> `esModuleInterop` (already on) handles default-import fallback. If named imports ever
> fail to resolve in the type-checker, fall back to a namespace import:
> `import * as mgmt from '@microsoft/dev-tunnels-management'`. See gotchas §5.

---

## 3. Key types & shapes

### `TunnelManagementHttpClient` constructor
([`ts/src/management/tunnelManagementHttpClient.ts`](https://github.com/microsoft/dev-tunnels/blob/main/ts/src/management/tunnelManagementHttpClient.ts))

```ts
new TunnelManagementHttpClient(
  userAgents: ProductHeaderValue | string | (ProductHeaderValue | string)[],
  apiVersion: ManagementApiVersions,                       // ManagementApiVersions.Version20230927preview
  userTokenCallback?: () => Promise<string | null>,        // returns the FULL Authorization header value, e.g. 'Bearer <token>'
  tunnelServiceUri?: string,                               // omit → defaults to the global prod service URI
  httpsAgent?: https.Agent,
  adapter?: AxiosAdapter,
)
```

- `userTokenCallback` returns the **whole header value** (scheme included), or `null`. The
  official sample returns `() => Promise.resolve(`Bearer ${aadToken}`)`. The SDK places it
  verbatim into the `Authorization` header. (`TunnelAuthenticationSchemes.aad = 'aad'`,
  `.github = 'github'`, `.tunnel = 'tunnel'`; tunnel-scoped tokens use `tunnel <token>`,
  but **user** tokens use `Bearer <token>` per the sample.)
- Omit `tunnelServiceUri` to use the production endpoint
  `https://global.rel.tunnels.api.visualstudio.com/` (see §4).
- `ManagementApiVersions.Version20230927preview = '2023-09-27-preview'` (only accepted value).

### `TunnelManagementClient` interface — methods used
([`ts/src/management/tunnelManagementClient.ts`](https://github.com/microsoft/dev-tunnels/blob/main/ts/src/management/tunnelManagementClient.ts))

```ts
createTunnel(tunnel: Tunnel, options?: TunnelRequestOptions): Promise<Tunnel>
createTunnelPort(tunnel: Tunnel, port: TunnelPort, options?: TunnelRequestOptions): Promise<TunnelPort>
deleteTunnel(tunnel: Tunnel, options?: TunnelRequestOptions): Promise<boolean>
deleteTunnelPort(tunnel: Tunnel, portNumber: number, options?: TunnelRequestOptions): Promise<boolean>
dispose(): Promise<void>
```

`createTunnel` auto-selects a `clusterId` (via the cluster-recommendations API) and
generates a `tunnelId` if you don't supply them — so a minimal `Tunnel` object is enough.

### `Tunnel` (essential fields)
([`ts/src/contracts/tunnel.ts`](https://github.com/microsoft/dev-tunnels/blob/main/ts/src/contracts/tunnel.ts))

```ts
interface Tunnel {
  clusterId?: string;          // set by the service on create
  tunnelId?: string;           // set by the service on create (or caller-supplied)
  name?: string;               // optional globally-unique alias
  accessTokens?: { [scope: string]: string };  // populated when tokenScopes requested
  accessControl?: TunnelAccessControl;         // { entries: TunnelAccessControlEntry[] }
  endpoints?: TunnelEndpoint[];                // populated after hosting
  ports?: TunnelPort[];                        // can be created inline with the tunnel
  accessControl?: TunnelAccessControl;
  expiration?: Date;
}
```

### `TunnelPort` (essential fields)
([`ts/src/contracts/tunnelPort.ts`](https://github.com/microsoft/dev-tunnels/blob/main/ts/src/contracts/tunnelPort.ts))

```ts
interface TunnelPort {
  portNumber: number;          // required
  protocol?: string;           // a TunnelProtocol value
  isDefault?: boolean;
  accessTokens?: { [scope: string]: string };
  accessControl?: TunnelAccessControl;
  portForwardingUris?: string[];   // ← public URIs, populated by the service (preferred URL source)
  clusterId?: string;
  tunnelId?: string;
}
```

### Enums

`TunnelAccessScopes` ([source](https://github.com/microsoft/dev-tunnels/blob/main/ts/src/contracts/tunnelAccessScopes.ts)):
`Create | Manage | ManagePorts | Host | Inspect | Connect` (string values: `'create'`,
`'manage'`, `'manage:ports'`, `'host'`, `'inspect'`, `'connect'`).

`TunnelAccessControlEntryType` ([source](https://github.com/microsoft/dev-tunnels/blob/main/ts/src/contracts/tunnelAccessControlEntryType.ts)):
`None | Anonymous | Users | Groups | Organizations | Repositories | PublicKeys | IPAddressRanges`.
Use `Anonymous` for `--allow-anonymous`-style connect access.

`TunnelProtocol` ([source](https://github.com/microsoft/dev-tunnels/blob/main/ts/src/contracts/tunnelProtocol.ts)):
`Auto | Tcp | Udp | Ssh | Rdp | Http | Https` (values `'auto'`, `'tcp'`, …, `'http'`, `'https'`).

### `TunnelEndpoint` + `getPortUri`
([`ts/src/contracts/tunnelEndpoint.ts`](https://github.com/microsoft/dev-tunnels/blob/main/ts/src/contracts/tunnelEndpoint.ts))

```ts
interface TunnelEndpoint {
  hostId: string;
  connectionMode: TunnelConnectionMode;
  portUriFormat?: string;   // template containing '{port}' — use TunnelEndpoint.getPortUri()
  tunnelUri?: string;       // URI for the default port
  hostPublicKeys?: string[];
}
export const TunnelEndpoint = { portToken: '{port}', getPortUri, getPortSshCommand };
// TunnelEndpoint.getPortUri(endpoint, portNumber) → string
```

### `TunnelHost` / `TunnelRelayTunnelHost`
([`ts/src/connections/tunnelHost.ts`](https://github.com/microsoft/dev-tunnels/blob/main/ts/src/connections/tunnelHost.ts))

```ts
interface TunnelHost extends TunnelConnection {
  connect(tunnel: Tunnel, options?: TunnelConnectionOptions, cancellation?: CancellationToken): Promise<void>;
  refreshPorts(): Promise<void>;
  // dispose() inherited from TunnelConnection (the sample calls host.dispose())
}
```

`TunnelRelayTunnelHost` is the concrete class: `new TunnelRelayTunnelHost(managementClient)`.
It connects to the relay over SSH/WebSocket and forwards remote connections to the local
port(s) declared on the tunnel. Set `host.trace = (level, eventId, msg, err) => …` for logs.

---

## 4. Authentication (device-code) — the SDK does NOT do this for you

The dev-tunnels SDK has **no built-in device-code flow**. `TunnelManagementHttpClient` only
takes a `userTokenCallback: () => Promise<string | null>`. Mobily implements the OAuth 2.0
device-code flow itself, then hands the resulting token to that callback as
`` `Bearer ${accessToken}` ``.

**Token audience (production):** `46da2f7e-b5ef-422a-88d4-2a7f9de6a0b2` — the Dev Tunnels
"Visual Studio Tunnel Service" first-party AAD App ID.
[`ts/src/contracts/tunnelServiceProperties.ts`](https://github.com/microsoft/dev-tunnels/blob/main/ts/src/contracts/tunnelServiceProperties.ts)
defines `prodFirstPartyAppId = '46da2f7e-b5ef-422a-88d4-2a7f9de6a0b2'` and documents:
*"Clients specify this AppId as the audience property when authenticating to the service."*
The production service URI default is
`https://global.rel.tunnels.api.visualstudio.com/` (`prodDnsName`).

Device-code flow (standard, mobily-owned — `common` tenant per the provisioning runbook):

```
POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/devicecode
      ?client_id={MOBILY_DEVTUNNELS_CLIENT_ID}
      &scope={audience}/.default offline_access
→ { user_code, device_code, verification_uri, expires_in, interval }

Poll:
POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
      grant_type=urn:ietf:params:oauth:grant-type:device_code
      client_id=...  device_code=...
→ { access_token, refresh_token, expires_in }
```

Then:

```ts
const tokenProvider = () => Promise.resolve(`Bearer ${accessToken}`);
const client = new TunnelManagementHttpClient(
  { name: 'mobily', version: '0.0.0' } satisfies ProductHeaderValue,
  ManagementApiVersions.Version20230927preview,
  tokenProvider,
);
```

> **Open integration question (already flagged in `devtunnels-provisioning.md`):** the
> official `devtunnel` CLI authenticates with a **Microsoft-owned first-party public
> client**. Whether a maintainer-registered *third-party* Entra app can mint an AAD/MSA
> token that the Dev Tunnels service accepts (audience
> `46da2f7e-b5ef-422a-88d4-2a7f9de6a0b2`) depends on the service exposing delegated
> permissions to arbitrary client apps. The runbook's "API permissions … confirm during
> integration" caveat covers exactly this. If a third-party app is rejected, the fallback
> is to reuse Microsoft's published first-party client ID (the value the `devtunnel` CLI
> uses) — verify against the C# CLI source during branch 2.

---

## 5. Step-by-step pattern (mapped to mobily's `TunnelBackend`)

Adapted from the official host sample. `DevTunnelsBackend` implements
`TunnelBackend { id; bindHost; connect(localPort) }` from `cli/src/tunnel/types.ts`.
`bindHost` is `'localhost'` (the tunnel forwards to the local WS server, no LAN exposure).

```ts
import {
  ManagementApiVersions, ProductHeaderValue, TunnelManagementHttpClient,
} from '@microsoft/dev-tunnels-management';
import type { TunnelRequestOptions } from '@microsoft/dev-tunnels-management';
import {
  Tunnel, TunnelAccessControlEntryType, TunnelAccessScopes, TunnelEndpoint, TunnelProtocol,
} from '@microsoft/dev-tunnels-contracts';
import { TunnelRelayTunnelHost } from '@microsoft/dev-tunnels-connections';
import type { TunnelBackend, TunnelConnection } from './types.js';

export class DevTunnelsBackend implements TunnelBackend {
  readonly id = 'devtunnels';
  readonly bindHost = 'localhost';

  constructor(private readonly accessToken: string) {} // obtained via device-code flow

  async connect(localPort: number): Promise<TunnelConnection> {
    const client = new TunnelManagementHttpClient(
      { name: 'mobily', version: '0.0.0' } satisfies ProductHeaderValue,
      ManagementApiVersions.Version20230927preview,
      () => Promise.resolve(`Bearer ${this.accessToken}`),
    );

    // 1. Create tunnel: anonymous Connect ACE + inline port.
    //    clusterId/tunnelId are auto-generated by the service.
    const options: TunnelRequestOptions = {
      tokenScopes: [TunnelAccessScopes.Host, TunnelAccessScopes.Connect],
      includePorts: true,
    };
    const tunnel: Tunnel = {
      accessControl: {
        entries: [{
          type: TunnelAccessControlEntryType.Anonymous,
          subjects: [],
          scopes: [TunnelAccessScopes.Connect],
        }],
      },
      ports: [{ portNumber: localPort, protocol: TunnelProtocol.Http }],
    };
    const created = await client.createTunnel(tunnel, options);

    // 2. Host: connect to the relay so remote connections reach localPort.
    const host = new TunnelRelayTunnelHost(client);
    host.trace = (level, eventId, msg, err) => { /* log */ };
    await host.connect(created);

    // 3. Read the public URL (prefer portForwardingUris; fall back to endpoint template).
    const port = created.ports?.find(p => p.portNumber === localPort);
    const url =
      port?.portForwardingUris?.[0] ??
      created.endpoints?.map(e => TunnelEndpoint.getPortUri(e, localPort))[0];
    if (!url) throw new Error('Dev Tunnels did not return a port URI');

    // The phone connects over WebSocket: switch https:// → wss:// (see gotchas §6).
    const wsUrl = url.replace(/^https:\/\//, 'wss://');

    return {
      url: wsUrl,
      disconnect: async () => {
        host.dispose();
        await client.deleteTunnel(created).catch(() => {});
        await client.dispose().catch(() => {});
      },
    };
  }
}
```

### Why this maps cleanly
- **Create + port in one call:** `createTunnel` accepts `ports[]` inline and creates them
  together (`convertTunnelForRequest` in the management client sends `ports` through
  `convertTunnelPortForRequest`). The sample relies on this.
- **Anonymous access:** the `Anonymous` ACE with `scopes: [Connect]` is the SDK equivalent
  of `--allow-anonymous` for *connectors*. Hosting still required the operator token (the
  `Bearer` callback) — consistent with ADR 0003.
- **Host token:** `tokenScopes: [Host, Connect]` makes the service issue a `Host`-scope
  token in `tunnel.accessTokens['host']`; `TunnelRelayTunnelHost` uses it to authenticate
  the relay connection.
- **Connect token for the phone:** `tunnel.accessTokens['connect']` is the token a remote
  client needs. (Mobily additionally gates the connection with its own Device Key
  challenge-response, so this token is an inner transport credential — see ADR 0001/0003.)

---

## 6. Gotchas

1. **Protocol choice for a WebSocket server.** `TunnelProtocol.Http` is right for a `ws://`
   local server (WS is an HTTP upgrade); use `Https` if the local server is `wss://`. The
   protocol is advisory (drives default-port selection and web forwarding) but does **not**
   change the relay transport. `Auto`/`Tcp` also work for raw forwarding.
2. **Public URL scheme is `https://`, not `wss://`.** `portForwardingUris` and
   `TunnelEndpoint.getPortUri()` return web-forwarding `https://` URLs. The phone's
   WebSocket client must connect to the same host over `wss://` (WebSocket upgrade). The
   exact relay `wss` endpoint format (and whether to append the Connect access token as a
   query param) is the **phone-side integration detail** to verify — the TS connections SDK
   only covers the *host* side here; the Android client implements its own WS dial.
3. **`userTokenCallback` returns the full header.** Return `` `Bearer ${token}` `` (with
   scheme), not the bare token. Returning `null` makes the request anonymous (only valid for
   tunnels/operations that allow it).
4. **pnpm peer dependencies.** `@microsoft/dev-tunnels-connections` needs
   `@microsoft/dev-tunnels-ssh` and `@microsoft/dev-tunnels-ssh-tcp` as **peers**. pnpm does
   not reliably auto-install peers — add them explicitly (§1). Missing them surfaces as a
   runtime `Cannot find module` from inside the connections SDK.
5. **ESM ↔ CommonJS interop.** CLI is ESM; the SDK is CJS. tsup/esbuild handles this at
   build time. If `tsc` complains about named imports from the CJS packages under
   `NodeNext`, switch to namespace imports (`import * as mgmt from '…'`).
6. **Bundle size / packaging.** The connections package is ~365 KB unpacked and pulls in
   `websocket`, `vscode-jsonrpc`, and the SSH packages. Either let tsup bundle them (larger
   `dist/index.js`) or mark them `external` in `tsup.config.ts` and keep them as runtime
   `dependencies` so the `npx` install pulls them. Marking `external` is recommended for an
   `npx`-shipped CLI.
7. **`accessControl.entries` are filtered on create.** The management client drops
   `isInherited` entries before sending (`convertTunnelForRequest`). Only set your own
   non-inherited ACEs; inherited ones come back from the service on read.
8. **Teardown order.** `host.dispose()` drops the relay session; `client.deleteTunnel(tunnel)`
   deletes the tunnel resource (the sample does both). `deleteTunnel` needs the tunnel's
   `clusterId` + `tunnelId` (present on the created object). Call `client.dispose()` to stop
   background event-upload tasks. `disconnect()` must be idempotent (wrap in `.catch(() => {})`
   — the `TunnelConnection` contract says safe to call multiple times).
9. **Cluster selection.** Don't hard-code `clusterId`; let `createTunnel` auto-recommend
   (it calls `getClusterRecommendations` when `clusterId` is unset). The returned `tunnel`
   has `clusterId`/`tunnelId` populated — keep a reference for `deleteTunnel`.
10. **Token lifetime.** AAD/MSA access tokens expire (~1 h). For a long-running CLI, cache
    the token + expiry and have `userTokenCallback` refresh via the refresh token
    (`offline_access`) when expired. The SDK calls the callback per request, so refresh can
    happen lazily there.

---

## 7. Source index (primary)

- Host sample (the canonical usage): `samples/ts/host/index.ts`, `package.json`, `tsconfig.json`
  — https://github.com/microsoft/dev-tunnels/tree/main/samples/ts/host
- Management client interface + constructor: `ts/src/management/tunnelManagementClient.ts`,
  `ts/src/management/tunnelManagementHttpClient.ts`
- Request options: `ts/src/management/tunnelRequestOptions.ts`
- Contracts: `ts/src/contracts/{tunnel,tunnelPort,tunnelAccessScopes,tunnelAccessControlEntryType,tunnelProtocol,tunnelEndpoint,tunnelServiceProperties,tunnelServicePropertiesStatics}.ts`
- Connections host: `ts/src/connections/{tunnelHost,tunnelRelayTunnelHost}.ts`; barrel `index.ts`
- Package versions + deps: https://registry.npmjs.org/@microsoft/dev-tunnels-management|connections|contracts
- Repo docs already in this project: `docs/devtunnels-provisioning.md`, `docs/adr/0003-pluggable-tunnel-backend.md`, `cli/src/tunnel/{types,config,local}.ts`
