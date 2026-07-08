# Mobily

A free and open-source mobile remote-control for terminal-based development environments. Stream live terminal sessions from your workstation to your Android phone over a secure tunnel.

## Features

- **Live terminal** — full `xterm.js` terminal on your phone with special key support (Ctrl, Alt, Esc, arrows)
- **Secure pairing** — QR code pairing with hardware-backed device keys (Android Keystore)
- **Session persistence** — terminal sessions survive disconnects via `tmux` (or bare PTY fallback)
- **Git GUI** — stage, diff, and commit from your phone without touching the terminal
- **Pluggable tunneling** — Dev Tunnels (default), Bore, Cloudflare, SSH, or local network
- **No cloud dependencies** — everything runs locally; no accounts, no relay servers required

## Quick Start

```bash
# On your workstation
npx mobily

# Scan the QR code with the Mobily Android app
```

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
