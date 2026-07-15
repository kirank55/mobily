# Phase 2 — Secure Tunnel & Pairing: Implementation Plan

> Historical plan. Dev Tunnels authentication was later replaced by guided
> orchestration of Microsoft's official `devtunnel` helper. See
> [`devtunnels-provisioning.md`](devtunnels-provisioning.md) for the current flow.

> Stacked-branch implementation of Phase 2 (`docs/tasks.md` lines 63–93).
> Each branch is based on the previous one; each gets a PR.
> Generated from a planning conversation and locked decisions.

## Locked decisions

1. **Default backend = Local (LAN), no auth** — `npx mobily` binds WS to `0.0.0.0`
   and returns `ws://<lan-ip>:<port>`. Zero end-user setup; Device Key still gates
   access. LAN-only (not remote over the internet).
2. **Dev Tunnels = opt-in** (`--tunnel devtunnels`). The operator logs in once via a
   device-code flow using a maintainer-registered Entra ID app (client ID baked into
   the CLI via config). The tunnel is opened with `--allow-anonymous`, so the phone
   connects without an MS account and proves identity via the Device Key.
   - Microsoft's docs state Dev Tunnels **cannot be hosted anonymously** — only
     *connecting* to a tunnel can be anonymous. This corrects the original
     "zero account setup" assumption in ADR 0003.
3. **Provisioning branch = runbook + `TunnelBackend` interface + `LocalBackend` +
   config plumbing** (minimizes end-user tasks; the maintainer does the one-time
   Entra ID app registration captured in the runbook, the client ID ships in the CLI).
4. **DevTunnelsBackend embeds `@microsoft/dev-tunnels-management` +
   `@microsoft/dev-tunnels-connections`** in-process with a device-code
   `TokenCredential`. (No shell-out to the `devtunnel` CLI.)
5. **Stacked branches, push + PR each.**

## Stacked-branch plan

| # | Branch | Deliverables | Verification |
|---|---|---|---|
| 1 | `phase2/1-devtunnels-provisioning` | `cli/src/tunnel/types.ts` (`TunnelBackend` interface: `connect(localPort) → { url }`, `disconnect()`); `cli/src/tunnel/local.ts` (`LocalBackend` — the no-auth default, returns LAN `ws://` URL); `cli/src/tunnel/config.ts` (reads Dev Tunnels client ID/tenant from env/config); `docs/devtunnels-provisioning.md` (Entra ID app registration runbook); update ADR 0003 + plan.md + tasks.md (default→local, Dev Tunnels opt-in); make `startServer` bind host configurable | `pnpm typecheck lint build test` green; `LocalBackend` unit test |
| 2 | `phase2/2-devtunnels-integration` | `cli/src/tunnel/devtunnels.ts` (`DevTunnelsBackend` via embedded SDKs + device-code `TokenCredential`: create tunnel, add port with `--allow-anonymous`, host → public `wss://` URL, tear down on disconnect); `--tunnel local\|devtunnels` flag (default `local`) wired in `index.ts`; tunnel URL fed forward | Fake-backend unit test (real Dev Tunnels validated manually); typecheck/lint/build/test green |
| 3 | `phase2/3-auth-pairing` | `cli/src/auth.ts` (crypto-random 6–8 alphanumeric pairing code, Device-Key binding store `{deviceId, publicKey, stationName, pairedAt}`, nonce challenge-response via Node crypto, burn code after bind); `/.well-known/mobily/pair` HTTP endpoint (TLS provided by Dev Tunnels ingress on the remote path; plain HTTP on LAN); WS auth-challenge/auth-response frames in `shared/protocol.ts` | Auth unit tests (code gen/validation, burn, sig verify/reject) |
| 4 | `phase2/4-pairing-code-display` | Print pairing code to terminal as plain text in `index.ts` (QR deferred to Phase 3) | Manual: run CLI, see code |
| 5 | `phase2/5-version-negotiation` | `shared/protocol.ts` `hello`/`hello-ack` frames + unit tests; handshake in `session.ts`/`ws.ts` sequenced as `hello → hello-ack → auth-challenge → auth-response` (reuses branch-3 auth frames); reject incompatible versions with error + close | Protocol unit tests; handshake integration test |
| 6 | `phase2/6-tests` | Auth/token lifecycle (mock tunnel); pairing flow E2E (HTTP pair → bind → WS connect with valid sig accepted); challenge-response auth (valid accepted, invalid/unbound rejected) — validates Phase 2 DoD | `pnpm test` green; manual `wscat` over `--tunnel devtunnels` for true-remote DoD |

## Execution workflow

For each branch:

1. Create the branch from the previous branch (branch 1 from `main`).
2. Implement the deliverables.
3. Run `pnpm typecheck lint build test` (via turbo) until green.
4. Commit (commit message style matches the Phase 1 history:
   `implement <section name>`).
5. Push to `origin`.
6. Open a PR.

Branch 1 also updates `docs/adr/0003-pluggable-tunnel-backend.md`,
`docs/plan.md`, and `docs/tasks.md` to reflect the default→local / Dev Tunnels
opt-in correction.

## Notes / risks

- **Auth vs version-negotiation sequencing:** `tasks.md` orders Auth (3) before
  Version Negotiation (5). To avoid rework, branch 3 adds reusable
  `auth-challenge`/`auth-response` frames; branch 5 sequences them after
  `hello`/`hello-ack`. Minimal retrofit.
- **LAN pairing is plain HTTP** (cleartext on LAN). Acceptable for Phase 2 — the
  pairing code is single-use/short-lived; the Dev Tunnels path is HTTPS. Local TLS
  via a self-signed cert is a future nicety.
- **Dev Tunnels SDK auth mechanism:** branch 2 follows
  `microsoft/dev-tunnels` `samples/ts/host` for the exact `TokenCredential`/
  device-code wiring against the provisioned client ID — confirmed at
  implementation time.
- **Real Dev Tunnels + Device-Key tests are manual** (need login + a real
  keypair); CI uses mocks/fakes.
- **Phase 2 DoD** ("remote machine connects via tunnel URL…") is met via the
  opt-in `--tunnel devtunnels`; `--tunnel local` is the zero-friction default for
  dev/LAN.
