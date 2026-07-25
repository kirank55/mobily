# Mobily

A free and open-source mobile remote-control for terminal-based development environments. Stream live terminal sessions from your workstation to your Android phone over a secure tunnel.

## Features

- **Live terminal** — full `xterm.js` terminal on your phone with special key support (Ctrl, Alt, Esc, arrows)
- **Secure pairing** — QR code pairing with hardware-backed device keys (Android Keystore)
- **Shared persistent session** — automatically uses tmux when available, with bounded replay on phone/network reconnects and a bare PTY fallback
- **Embedded workstation terminal** — the launching CLI becomes an interactive mirror of the Android session after setup
- **Background terminal alerts** — an Android foreground service reports session progress (Working / Waiting for input / Finished), the latest terminal line, and prompts that need attention
- **Native Git controls** — browse changes, stage/unstage, inspect large diffs, switch branches, and commit from Android
- **Multiple Stations** — retain paired workstations and switch between them without scanning again
- **Pluggable tunneling** — Dev Tunnels for remote access, plus pinned TLS directly on your LAN
- **No Mobily-operated cloud** — secure remote access currently uses Microsoft Dev Tunnels and requires operator authentication

## Quick Start

```bash
# Secure remote access (guides first-time install and login)
npx mobily --tunnel devtunnels
```

After printing tunnel and pairing details, Mobily hands its interactive console
to the shared terminal. Commands and PTY output are visible on both Android and
the workstation. Ctrl+C interrupts the shared session. In a tmux-backed
workstation terminal, run `mobily exit` to exit Mobily; in the bare PTY fallback,
Ctrl+X exits Mobily.

When tmux is available, this terminal attaches to the shared Session after the
phone authenticates (QR header above the shell). Mobily also prints the exact
command for attaching an additional workstation terminal. Use `--session <name>`
to choose a stable name:

```bash
npx mobily --tunnel devtunnels --session project-x
tmux attach-session -t project-x
```

Normal CLI shutdown only detaches Mobily; it does not kill the tmux session.
Use `npx mobily --kill-session project-x` when you intentionally want to remove
it. If tmux is unavailable, the embedded terminal still mirrors Android while
the CLI is alive, but the bare session cannot survive CLI exit or accept an
additional tmux attachment. Redirected/non-TTY CLI processes remain remote-only.

### Dev Tunnels helper

Mobily uses Microsoft's official `devtunnel` helper (GitHub, Microsoft personal,
or Entra ID). Credentials are cached by the helper. No Mobily OAuth client ID or
`MOBILY_DEVTUNNELS_*` environment variable is required.

If the helper is missing, Mobily prints the install command. Typical installs:

```bash
# Linux / WSL
curl -sL https://aka.ms/DevTunnelCliInstall | bash

# macOS
brew install --cask devtunnel

# Windows
winget install Microsoft.devtunnel
```

Force a provider or verbose diagnostics:

```bash
npx mobily --tunnel devtunnels --devtunnels-provider github
npx mobily --tunnel devtunnels --devtunnels-provider microsoft
npx mobily --tunnel devtunnels --verbose
```

If an interrupted run left the account quota full:

```bash
devtunnel delete-all
```

Official CLI reference:
https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/cli-commands

Device Key bindings are persisted on the Station in `~/.mobily/device-bindings.json`.
Use `npx mobily --list-bindings` to inspect them and
`npx mobily --revoke-binding <binding-id>` to revoke one.

For account-free use on the same Wi-Fi network, run `npx mobily --tunnel local`.
Mobily creates a long-lived self-signed Station certificate, stores it with
restrictive permissions in `~/.mobily/local-tls.json`, and puts its SHA-256 pin
in the QR. Android verifies that pin for both pairing HTTPS and terminal WSS.
Plaintext remains available only for browser protocol development with
`--tunnel local --allow-insecure-local`; the Android production flow refuses it.

## Local development (CLI + Expo web)

Day-to-day validation without Android Studio: run the Station CLI and the Expo
web app in Chrome. Requires Node ≥ 20 and pnpm.

On Windows, run these commands **inside WSL** (`wsl`, then `cd ~/code-wsl/mobily`).
Do not use PowerShell against `\\wsl.localhost\…` — Windows Node cannot resolve
pnpm workspace symlinks there, and `npm`/`pnpm` fail on UNC paths.

```bash
pnpm install
pnpm build
```

Gate before manual testing:

```bash
pnpm typecheck
pnpm --filter mobily-android lint
pnpm build
pnpm --filter @mobily/shared test
pnpm --filter mobily test
pnpm --filter mobily-android exec vitest run
```

Full `pnpm lint` may fail on unrelated CLI fixtures; full `pnpm test` also runs
Playwright under android and can hang — use `vitest run` for the android unit
gate.

**Terminal A — Station**

```bash
pnpm build && pnpm --filter mobily exec node dist/index.js --tunnel local --allow-insecure-local
```

**Terminal B — Expo web**

```bash
pnpm --filter mobily-android web
```

On the web pair screen, paste the `mobily://pair?…` payload or enter
`ws://localhost:<port>` plus the pairing code. If the browser is blank, clear
Metro cache with `pnpm --filter mobily-android exec expo start --web -c`.

Browser protocol harness (no Expo UI): open the Smoke test URL the CLI prints
(`cli/dev/smoke.html?…`).

## Architecture

```
cli/       — Node.js CLI that runs on your workstation (PTY, WebSocket, tunnel)
android/   — React Native (Expo) Android app
shared/    — Shared TypeScript types and protocol definitions
docs/adr/  — Architectural decision records
```

## Documentation

- [Domain Glossary](CONTEXT.md) — canonical terminology
- [ADRs](docs/adr/) — architectural decision records
- [Terminal testing via Dev Tunnels](docs/tunnel-terminal-testing.md) — manual validation plan
- [Security](SECURITY.md) — dependency audit dispositions

## License

[MIT](LICENSE)
