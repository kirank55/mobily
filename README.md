# Mobily

A free and open-source mobile remote-control for terminal-based development environments. Stream live terminal sessions from your workstation to your Android phone over a secure tunnel.

## Features

- **Live terminal** — full `xterm.js` terminal on your phone with special key support (Ctrl, Alt, Esc, arrows)
- **Secure pairing** — QR code pairing with hardware-backed device keys (Android Keystore)
- **Shared persistent session** — automatically uses tmux when available, with bounded replay on phone/network reconnects and a bare PTY fallback
- **Embedded workstation terminal** — the launching CLI becomes an interactive mirror of the Android session after setup
- **Background terminal alerts** — an Android foreground service reports connection state, the latest terminal line, and prompts that need attention
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
the workstation. Ctrl+C interrupts the shared session; Ctrl+X exits Mobily.

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

On first use, Mobily guides installation of Microsoft's official `devtunnel`
helper and offers GitHub or Microsoft device-code login. Credentials are cached
by the helper for later runs.

Device Key bindings are persisted on the Station in `~/.mobily/device-bindings.json`.
Use `npx mobily --list-bindings` to inspect them and
`npx mobily --revoke-binding <binding-id>` to revoke one.

For account-free use on the same Wi-Fi network, run `npx mobily --tunnel local`.
Mobily creates a long-lived self-signed Station certificate, stores it with
restrictive permissions in `~/.mobily/local-tls.json`, and puts its SHA-256 pin
in the QR. Android verifies that pin for both pairing HTTPS and terminal WSS.
Plaintext remains available only for browser protocol development with
`--tunnel local --allow-insecure-local`; the Android production flow refuses it.

## Architecture

```
cli/       — Node.js CLI that runs on your workstation (PTY, WebSocket, tunnel)
android/   — React Native (Expo) Android app
shared/    — Shared TypeScript types and protocol definitions
docs/      — Plan, tasks, and architectural decision records
```

## Documentation

- [Plan](docs/plan.md) — project roadmap and technical decisions
- [Tasks](docs/tasks.md) — phase-by-phase implementation checklist
- [Domain Glossary](CONTEXT.md) — canonical terminology
- [ADRs](docs/adr/) — architectural decision records

## License

[MIT](LICENSE)
