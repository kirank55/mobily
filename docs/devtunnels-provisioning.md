# Dev Tunnels Provisioning Runbook

> One-time manual task for maintainers. Registers an Entra ID (Azure AD)
> application that lets the `DevTunnelsBackend` authenticate the CLI operator via
> the OAuth 2.0 device-code flow. The resulting client ID ships with the CLI.

## Why this is needed

Microsoft Dev Tunnels **cannot be hosted anonymously** — the operator must
authenticate with a Microsoft, Entra ID, or GitHub account. Anonymous access
applies only to *connecting* to a tunnel (which mobily gates with its own
Device Key auth). See
[Dev tunnels security](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/security).

`LocalBackend` (LAN, zero setup) is the default. Dev Tunnels is the opt-in
remote path (`--tunnel devtunnels`). This runbook provisions the app
registration that makes that path work without each user registering their own
app.

## Steps

### 1. Register an Entra ID application

1. Sign in to the [Azure Portal](https://portal.azure.com) → **Microsoft Entra
   ID** → **App registrations** → **New registration**.
2. **Name:** `mobily-devtunnels` (or similar).
3. **Supported account types:** *Accounts in any organizational directory and
   personal Microsoft accounts* — this matches the `'common'` tenant.
4. **Redirect URI:** None required for the device-code flow. Leave blank.
5. Click **Register**.

### 2. Copy the application (client) ID

On the app's **Overview** page, copy the **Application (client) ID**. This is
the `clientId` that goes into the CLI.

### 3. Enable the device-code flow

1. **Authentication** → enable **Allow public client flows** → set the toggle
   to **Yes**. (The device-code flow requires a public client.)
2. Save.

### 4. Bake the client ID into the CLI

Set the `MOBILY_DEVTUNNELS_CLIENT_ID` environment variable at build/publish
time, or edit `cli/src/tunnel/config.ts` and set `DEFAULT_CLIENT_ID` to the
copied value.

```ts
// cli/src/tunnel/config.ts
const DEFAULT_CLIENT_ID = 'your-copied-client-id-here';
```

The tenant ID defaults to `'common'` (multi-tenant). Override with
`MOBILY_DEVTUNNELS_TENANT_ID` if you want to restrict to a specific tenant.

### 5. Validate

```bash
npx mobily --tunnel devtunnels
```

The CLI should prompt for a device-code login:

```
To sign in, use a web browser to open https://microsoft.com/devicelogin
and enter the code XXXXXXXXX to authenticate.
```

After login, a public `wss://<tunnel-id>.devtunnels.ms` URL is printed.

## Notes

- **No client secret** is needed — the device-code flow uses a public client.
- **API permissions:** Dev Tunnels uses delegated permissions. The app
  registration may need `DevTunnels` API permissions depending on the SDK's
  requirements — confirm during integration (branch 2).
- **Rate limits / quotas:** The anonymous tunnel tier has rate limits and
  session lifetime limits. Document observed limits during Phase 2 testing.
- **Alternative backends:** Bore, Cloudflare, SSH, or local network can be
  added via the `TunnelBackend` interface without repeating this provisioning.
