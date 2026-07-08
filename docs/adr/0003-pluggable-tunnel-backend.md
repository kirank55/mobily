# Pluggable tunnel backend with anonymous Dev Tunnels as default

The tunneling layer is behind a `TunnelBackend` interface rather than hard-wired to Microsoft Dev Tunnels. The default implementation uses Dev Tunnels with anonymous auth (no Microsoft account required).

This is driven by FOSS goals: an open-source project shouldn't force users onto a single proprietary service. The interface is small (`connect()` → URL, `disconnect()`), so adding backends for Bore, Cloudflare Tunnels, SSH reverse tunnels, or local-network mode is incremental.

Anonymous Dev Tunnels were chosen over MSA (Microsoft Account) auth as the default because they require zero account setup — `npx mobily` works immediately.

**Considered alternatives:**

- **Dev Tunnels with MSA auth (hard-wired)** — the original plan. Stable URLs, but forces a Microsoft account and locks the project to one provider.
- **Bore as default** — fully open-source and self-hostable, but requires running a relay server. Higher setup friction than Dev Tunnels anonymous.
- **No abstraction, just Dev Tunnels** — simpler code, but paints the FOSS project into a corner if Microsoft changes terms or a contributor wants an alternative.
