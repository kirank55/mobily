# mobily — Task List

> **How to use:** Work top-to-bottom. Each phase has one goal. Don't start a phase
> until the previous phase's DoD is met. Within a phase, complete steps in order —
> each step lists what to build and where. Only build what's listed; anything else
> belongs in a later phase.
>
> **Dev/debug code is kept separate from production source in every phase.**
> Smoke pages, debug harnesses, latency instrumentation, and similar dev-only
> artifacts live in a `dev/` subfolder of their package (e.g. `cli/dev/`), never
> alongside production source in `src/`. Production packages exclude `dev/` from
> their published `files` list.

## Phase 0 — CLI Scaffold
**Goal:** A standalone `cli/` package builds green. Nothing functional yet.

- [x] `cli/` package: `package.json`, TypeScript, eslint, prettier, tsup, `bin` entry for `npx mobily`
- [x] Stub `main()` that prints version (no functionality yet)
- [x] Verify: `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm build` (in `cli/`) all succeed

**DoD:** All of the above pass.

---

## Phase 1 — Proof of Concept CLI (PTY + WebSocket)
**Goal:** Local terminal streaming with session persistence, validated from a browser.

### Monorepo Setup
- [x] `pnpm-workspace.yaml` (packages: `cli`, `shared`)
- [x] `turbo.json` with `typecheck`, `lint`, `build`, `test` pipelines
- [x] Create `shared/` package (`package.json`, TypeScript)
- [x] CI: GitHub Actions — typecheck + lint + build + test via turbo pipelines across `cli` + `shared`

### Shared Wire Protocol
- [x] `shared/protocol.ts`: frame types — `input`, `output`, `resize`
- [x] Unit tests (vitest): frame encode/decode round-trip + error cases

### node-pty Validation
- [x] `cli/src/pty/node-pty.ts`: PTY wrapper — `spawn()`, `write()`, `onData()`, `resize()`, `kill()` (extract a `PtyBackend` interface only if a second implementation materializes)
- [x] Pin `node-pty` to `1.1.0` (prebuilts available); validate build on Windows without VS Build Tools
- [x] CI matrix: win/mac/linux `node-pty` build
- [x] Test (vitest): `cli/tests/pty.test.ts` — spawns a shell on Windows

### WebSocket Server
- [x] `cli/src/ws.ts`: `ws` server on `localhost:<port>`
- [x] `cli/src/session.ts`: glue PTY ↔ WS; encode/decode JSON frames; hold the `PtyProcess` directly so the session survives WS disconnect (bare behavior — the `SessionBackend` abstraction + `TmuxBackend` arrive in Phase 5, when tmux's crash-survival benefit is first exercised)

### Browser Smoke Test
- [x] `cli/dev/smoke.html`: connect to WS, render output, send keys, resize
- [x] Verify: `vim`/`nano`/`htop` render correctly

### Lifecycle
- [x] Clean shutdown on client disconnect (session stays alive)
- [x] SIGINT handler kills PTY gracefully

### Tests
- [x] Integration test: WS client → PTY round-trip

**DoD:** type in browser → drives real shell; `vim`/`nano`/`htop` render correctly; resize propagates; close browser → reopen → session alive (PTY held by CLI process).

---

## Phase 2 — Secure Tunnel & Pairing
**Goal:** Public/LAN URL with device-bound auth; QR pairing flow.

### Dev Tunnels Provisioning
- [ ] Microsoft Dev Tunnels app registration (device-code auth via Entra ID) — manual external task; see `docs/devtunnels-provisioning.md`
- [x] `cli/src/tunnel/types.ts`: `TunnelBackend` interface — `connect(localPort)` → `TunnelConnection { url, disconnect() }`, plus `bindHost`
- [x] `cli/src/tunnel/local.ts`: `LocalBackend` — the default; binds WS to `0.0.0.0`, returns `ws://<lan-ip>:<port>`; zero account, no external service
- [x] `cli/src/tunnel/config.ts`: Dev Tunnels config loader (client ID + tenant from env/baked-in default)
- [x] Update ADR 0003 + plan.md: default→local, Dev Tunnels opt-in, correct anonymous-hosting assumption
- [x] Test (vitest): `cli/tests/tunnel.test.ts` — LocalBackend URL shape, bindHost, disconnect

### Dev Tunnels Integration
- [x] `cli/src/tunnel/devtunnels.ts`: Dev Tunnels client (embedded `@microsoft/dev-tunnels` SDKs + device-code `TokenCredential`) — create tunnel, add port `--allow-anonymous`, host → `wss://` URL, `disconnect()` tears down
- [x] `cli/src/tunnel/device-code.ts`: OAuth 2.0 device-code flow against Entra ID (SDK has no built-in auth)
- [x] `cli/src/tunnel/index.ts`: `createTunnelBackend(tunnelId)` factory + `isTunnelId()` type guard
- [x] CLI flag: `--tunnel local|devtunnels` (default: `local`) wired in `index.ts` via `node:util.parseArgs`
- [x] Test (vitest): factory returns LocalBackend for 'local'; throws for 'devtunnels' when unconfigured; `isTunnelId` validates

### Auth & Pairing
- [x] `cli/src/auth.ts`: generate short pairing code (6-8 alphanumeric, cryptorandom)
- [x] HTTPS pairing endpoint at `/.well-known/mobily/pair` (HTTP on local, TLS via Dev Tunnels ingress on remote)
- [x] On pairing: validate code → receive Device Key (public key) → store `{ deviceId, publicKey, stationName, pairedAt }` → return `{ tunnelUrl, stationName, protocolVersion }`
- [x] On reconnect: send nonce challenge → verify Device Key signature → accept/reject
- [x] Pairing code burned after first successful bind
- [x] `shared/protocol.ts`: add `auth-challenge` / `auth-response` frame types + `PROTOCOL_VERSION`
- [x] `cli/src/ws.ts` refactored to shared HTTP+WS server (pairing endpoint + WS on same port/tunnel)
- [x] Test (vitest): `cli/tests/auth.test.ts` — code gen/validation, burn, challenge-response (real EC keypair)

### Pairing Code Display
- [x] Print pairing code to terminal as plain text (QR rendering deferred to Phase 3, when the phone scanner arrives)

### Version Negotiation
- [x] `shared/protocol.ts`: add `hello` / `hello-ack` frame types
- [x] `hello`/`hello-ack` frame exchange on WS connect (handshake in `session.ts`: hello → hello-ack → auth-challenge → auth-response)
- [x] Incompatible versions: send error message and close connection
- [x] Integration tests: full handshake with valid auth, version mismatch, invalid signature, unbound device

### Tests
- [x] Unit tests: auth/token lifecycle (mock tunnel) — `cli/tests/auth.test.ts`: code expiry, replacement, multiple devices, re-pair, multiple challenge-response cycles
- [x] Integration test: pairing flow end-to-end — `cli/tests/pairing.test.ts`: HTTP pair → WS handshake → PTY stream; HTTP error cases (wrong code, missing fields, unknown path, invalid JSON); reconnect after disconnect
- [x] Integration test: challenge-response auth — `cli/tests/ws.test.ts`: full handshake, version mismatch, invalid signature, unbound device

**DoD:** remote machine connects via tunnel URL and streams shell; unauthenticated connections refused; Device Key challenge-response works; unbound device rejected.

---

## Phase 3 — Basic Android App
**Goal:** Live terminal session from the phone with robust connection handling.

### Android Scaffold
- [x] Expo SDK app shell (prebuild/dev-client, not Expo Go); add `android/` to `pnpm-workspace.yaml`
- [x] Install `react-native-vision-camera`
- [x] Verify: `pnpm android:prebuild` succeeds; dev-client builds and launches on device/emulator

### QR Scanner & Pairing
- [x] `cli/src/qr.ts`: emit terminal QR encoding the short pairing code; verify renders cleanly in Windows Terminal, iTerm, VS Code
- [x] `android/app/scanner/`: QR scanner via `react-native-vision-camera`
- [x] Extract pairing code from QR
- [x] HTTPS handshake with CLI pairing endpoint
- [x] Receive connection payload (tunnel URL, station name, protocol version)

### Device Key Auth
- [x] Install `react-native-biometrics`; rebuild dev-client
- [x] `android/app/auth/`: Device Key management via `react-native-biometrics`
- [x] On pairing: `createKeys()` → send public key to CLI
- [x] On reconnect: receive nonce → `createSignature({ payload: nonce })` → send signature

### WebSocket Client
- [x] `android/app/client/`: WS client with exponential backoff reconnect
- [x] Device Key challenge-response in WS handshake
- [x] `hello`/`hello-ack` version negotiation

### Terminal WebView
- [x] `android/app/terminal/`: `WebView` hosting bundled `xterm.js`
- [x] Bridge: `postMessage`/`injectedJavaScript`
- [x] Phone-side output batching: accumulate WS data → flush on `requestAnimationFrame`
- [x] Output frames → `term.write()`
- [x] Input (keystrokes, paste) → WS `input` frame
- [x] Resize → `term.resize()` → WS `resize` frame

### Extra Key Row
- [x] Termux-style key row in WebView: `Esc | Ctrl | Alt | Tab | ← | → | ↑ | ↓`
- [x] Ctrl/Alt as toggle buttons (arm → next keypress → auto-disarm)
- [x] Soft keyboard + hardware keyboard support

### Latency Measurement
- [x] Instrument keystroke-to-echo round-trip time
- [x] Log P50/P95
- [x] Document baseline latency with Dev Tunnels

### Connection State Machine
- [x] Connection state: `disconnected → connecting → connected → reconnecting → failed`
- [x] App resume triggers `reconnecting` if connection is lost (formal `foreground | background` state machine deferred to Phase 5, when the foreground service needs it)
- [x] `connecting`: spinner + "Connecting to {stationName}..."
- [x] `connected`: terminal view + green indicator
- [x] `reconnecting`: overlay with attempt count, exponential backoff (1s→2s→4s→max 30s)
- [x] `failed`: "Connection lost" + retry button + re-scan option

### Error UX
- [x] Auth rejection: "Device not recognized — scan QR to re-pair"
- [x] Station offline: "Station unreachable — is the CLI running?"
- [x] Network change (wifi ↔ cellular): auto-reconnect
- [x] Version mismatch: "Please update" message

### Data Model
- [x] Persist current pairing as a single record in encrypted storage: `{ stationName, tunnelUrl, pairedAt }`
- [x] Device Key stored in Android Keystore (per-station keypair)

### Tests
- [x] Maestro: scan → connect → verify native UI states
- [x] Maestro: error states render correct messages

**DoD:** scan QR → paired → connected → type on phone → live output; reconnects after background → foreground; error states render correct messages; high-throughput output (`cat large_file`) doesn't drop frames; latency measured and documented (P50/P95).

---

## Phase 4 — Structured Git Features
**Goal:** Native Git GUI without reading raw terminal.

### Protocol Extension
- [ ] `shared/protocol.ts`: add `rpc` request/response frames

### Git RPC Handlers
- [ ] `cli/src/git/status.ts`: `simple-git` — file status as JSON
- [ ] `cli/src/git/log.ts`: `simple-git` — commit log as JSON
- [ ] `cli/src/git/branch.ts`: `simple-git` — branch list/switch
- [ ] `cli/src/git/stage.ts`: `simple-git` — stage/unstage files
- [ ] `cli/src/git/commit.ts`: `simple-git` — commit with message
- [ ] `cli/src/git/diff.ts`: add `rpc-stream` chunked response frames to `shared/protocol.ts` (`{ type, id, chunk, done }`); raw `git diff` spawn → stream as `rpc-stream` frames

### Android Git UI
- [ ] `android/app/git/`: file list (virtualized)
- [ ] Unified diff view
- [ ] Side-by-side diff view
- [ ] Branch picker
- [ ] Commit dialog

### Host List UI
- [ ] Generalize pairing storage from single record to list: `[{ stationName, tunnelUrl, pairedAt }]`
- [ ] `android/app/hosts/`: station list screen
- [ ] Station name, last connected, status indicator (online/offline)
- [ ] Switch between stations without re-scanning

### Tests
- [ ] vitest: Git RPC handlers (mock git repo)
- [ ] Maestro: host list navigation

**DoD:** browse changes, stage, commit from phone without terminal; large diffs (1000+ lines) render without jank; switch between multiple paired stations.

---

## Phase 5 — Polish & Backgrounding
**Goal:** Native-feeling persistence + background alerts.

### SessionBackend Abstraction
- [ ] `cli/src/mux/types.ts`: `SessionBackend` interface
- [ ] `cli/src/mux/bare.ts`: `BareBackend` — extract the Phase 1 inline bare behavior (PTY held by CLI process) behind the interface
- [ ] `cli/src/mux/tmux.ts`: `TmuxBackend` — wrap PTY in `tmux` for crash survival; create named session, reattach on reconnect
- [ ] Auto-detect: use `TmuxBackend` if `tmux` on `$PATH`, else `BareBackend`
- [ ] Refactor `session.ts` to use `SessionBackend` instead of holding `PtyProcess` directly

### Scrollback Replay
- [ ] `TmuxBackend`: replay last N lines via `tmux capture-pane` on reconnect
- [ ] `BareBackend`: in-process ring buffer → replay on reconnect

### WebSocket Alerts
- [ ] `shared/protocol.ts`: add `alert` frame type
- [ ] CLI: detect agent prompt / idle-timeout via PTY output heuristics
- [ ] Send `{ type: "alert", message }` frame over WS
- [ ] Android: foreground service updates notification with alert content

### Foreground Service
- [ ] `android/app/foreground.ts`: keep WS alive in background
- [ ] Ongoing notification: connection status + last terminal line + agent alerts

### Reconnect Polish
- [ ] On app resume: re-auth (Device Key) → reattach session → replay scrollback
- [ ] Survive network changes transparently

### Tests
- [ ] vitest: scrollback replay (both backends)
- [ ] Maestro: background → foreground → reconnected
- [ ] Maestro: notification shows alert content

**DoD:** agent prompt → notification → user opens app → responds → agent continues; long sessions survive backgrounding + network changes; with tmux, sessions survive CLI crash; works on API 26+.
