# Pluggable tunnel backend with local LAN as default

The tunneling layer is behind a `TunnelBackend` interface rather than hard-wired
to a single provider. The default implementation is `LocalBackend` (LAN, no
account); Microsoft Dev Tunnels is an opt-in remote backend.

## Default: LocalBackend (LAN)

`LocalBackend` binds the WebSocket server to `0.0.0.0` and exposes it at
`ws://<lan-ip>:<port>`. Zero account setup, no external service — `npx mobily`
works immediately on any local network. Device Key auth (Phase 2) still gates
access. The phone and the Station must be on the same network.

## Opt-in remote: DevTunnelsBackend

Dev Tunnels is the remote path, enabled via `--tunnel devtunnels`. **Dev Tunnels
cannot be hosted anonymously** — the operator must authenticate with a
Microsoft/GitHub account. Anonymous access applies only to *connecting* to a
tunnel (the tunnel is opened with `--allow-anonymous`), and mobily gates that
connection with its own Device Key challenge-response auth. The phone never
needs a Microsoft account.

The operator authenticates once via a device-code flow using a maintainer-
registered Entra ID app (client ID baked into the CLI). See
[`docs/devtunnels-provisioning.md`](../devtunnels-provisioning.md).

## Why the interface exists

Driven by FOSS goals: an open-source project shouldn't force users onto a single
proprietary service. The interface is small (`connect(localPort)` →
`TunnelConnection { url, disconnect() }`, plus `bindHost`), so adding backends
for Bore, Cloudflare Tunnels, SSH reverse tunnels, or other providers is
incremental.

**Considered alternatives:**

- **Dev Tunnels with anonymous hosting (original plan)** — the original ADR
  assumed Dev Tunnels could be hosted anonymously for zero-setup `npx mobily`.
  Microsoft's docs confirm this is not possible: hosting always requires
  authentication. Corrected to LocalBackend as default.
- **Dev Tunnels with MSA auth (hard-wired, default)** — stable URLs, but forces
  a Microsoft account on every operator and locks the project to one provider.
  Rejected for the same FOSS reasons; kept as an opt-in backend.
- **Bore as default** — fully open-source and self-hostable, but requires
  running a relay server or depending on a third-party community relay. Higher
  setup friction than LocalBackend. Can be added as a future backend.
- **No abstraction, just local** — simpler code, but paints the project into a
  corner if a contributor wants a remote path or an alternative provider.
