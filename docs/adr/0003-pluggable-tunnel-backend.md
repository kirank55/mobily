# Pluggable tunnel backend with explicit secure transport selection

The tunneling layer is behind a `TunnelBackend` interface rather than hard-wired
to a single provider. There is no implicit tunnel default. Microsoft Dev
Tunnels is the supported secure phone transport; `LocalBackend` remains an
explicit development escape hatch for the browser smoke harness.

## Development-only: LocalBackend (LAN)

`LocalBackend` binds the WebSocket server to `0.0.0.0` and exposes it at
`ws://<lan-ip>:<port>`. It requires both `--tunnel local` and
`--allow-insecure-local`. Device Key auth does not encrypt terminal traffic, so
the production Android client refuses this mode. It is reserved for
isolated-network browser development.

## Secure phone transport: DevTunnelsBackend

Dev Tunnels is the remote path, enabled via `--tunnel devtunnels`. **Dev Tunnels
cannot be hosted anonymously** — the operator must authenticate with a
Microsoft/GitHub account. Anonymous access applies only to _connecting_ to a
tunnel (the tunnel is opened with `--allow-anonymous`), and mobily gates that
connection with its own Device Key challenge-response auth. The phone never
needs a Microsoft account.

The operator authenticates once through Microsoft's official `devtunnel`
helper, choosing GitHub or Microsoft device-code login. The helper owns secure
credential caching; Mobily owns the guided first-run experience and temporary
tunnel lifecycle. See
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
  authentication. Corrected first to LocalBackend as the default, then to
  explicit tunnel selection after the plaintext transport review.
- **Dev Tunnels with MSA auth (hard-wired, default)** — stable URLs, but forces
  a Microsoft account on every operator and locks the project to one provider.
  Rejected for the same FOSS reasons; kept as an opt-in backend.
- **Bore as default** — fully open-source and self-hostable, but requires
  running a relay server or depending on a third-party community relay. Higher
  setup friction than LocalBackend. Can be added as a future backend.
- **No abstraction, just local** — simpler code, but paints the project into a
  corner if a contributor wants a remote path or an alternative provider.
