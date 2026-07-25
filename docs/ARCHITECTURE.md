# Architecture

Mobily is a pnpm monorepo: a Node.js Station CLI on the workstation, a React Native
(Expo) Android client, shared wire-protocol types, and a marketing site.

```
mobily/
├── cli/                     # npm package "mobily" — Station CLI
│   └── src/
│       ├── index.ts         # Entry: lifecycle + dispatch
│       ├── cliArgs.ts       # Argv parsing and early exits
│       ├── runStation.ts    # Compose auth, tunnel, session, QR, presence
│       ├── session.ts       # Session facade (PTY ↔ WebSocket clients)
│       ├── sessionHandshake.ts
│       ├── sessionSize.ts
│       ├── sessionScrollback.ts
│       ├── ws.ts            # HTTP(S) + WebSocket server
│       ├── auth.ts          # Pairing HTTP + Device Key challenges
│       ├── bindings.ts      # Persisted Device Key bindings
│       ├── pty.ts           # node-pty wrapper
│       ├── terminalScreen.ts
│       ├── gitService.ts / rpcRouter.ts
│       ├── sessionBackend/  # bare PTY + tmux backends
│       ├── workstation/     # embedded / tmux attach presence
│       ├── tunnel/          # local TLS + Dev Tunnels
│       └── alerts/          # session phase / alert heuristics
├── android/                 # Expo Android app
│   └── src/
│       ├── app/             # Expo Router thin routes
│       ├── stations/        # paired Stations list
│       ├── scanner/         # QR pairing
│       ├── terminal/        # xterm.js Session UI
│       ├── git/             # native Git screens
│       ├── auth/ / client/ / foreground/ / ui/
│       └── modules/         # Expo native modules (Kotlin)
├── shared/                  # @mobily/shared protocol types (bundled into CLI)
├── website/                 # Marketing site
├── docs/adr/                # Architectural decision records
└── .github/workflows/       # CI + release
```

## Runtime shape

```
Your machine                                      Your phone
┌─────────────────────────────────┐               ┌──────────────────────────┐
│  mobily Station (Node)          │  WSS / tunnel │  Mobily Android          │
│  PTY / tmux Session             │◄─────────────►│  xterm.js WebView        │
│  Device Key auth + Git RPC      │   local TLS   │  Device Key (Keystore)   │
│  Dev Tunnels or LAN             │   or Dev      │  Stations / Git / alerts │
└─────────────────────────────────┘   Tunnels     └──────────────────────────┘
```

Domain vocabulary lives in [`CONTEXT.md`](../CONTEXT.md). Decisions are recorded
under [`docs/adr/`](adr/).
