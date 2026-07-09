# mobily — Task List

> **How to use:** Work top-to-bottom. Each phase has one goal. Don't start a phase
> until the previous phase's DoD is met. Within a phase, complete steps in order —
> each step lists what to build and where. Only build what's listed; anything else
> belongs in a later phase.

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
- [ ] `cli/src/pty/node-pty.ts`: PTY wrapper — `spawn()`, `write()`, `onData()`, `resize()`, `kill()` (extract a `PtyBackend` interface only if a second implementation materializes)
- [ ] Pin `node-pty` to `1.1.0` (prebuilts available); validate build on Windows without VS Build Tools
- [ ] CI matrix: win/mac/linux `node-pty` build
- [ ] Test (vitest): `cli/tests/pty.test.ts` — spawns a shell on Windows

### WebSocket Server
- [ ] `cli/src/ws.ts`: `ws` server on `localhost:<port>`
- [ ] `cli/src/session.ts`: glue PTY ↔ WS; encode/decode JSON frames; hold the `PtyProcess` directly so the session survives WS disconnect (bare behavior — the `SessionBackend` abstraction + `TmuxBackend` arrive in Phase 5, when tmux's crash-survival benefit is first exercised)

### Browser Smoke Test
- [ ] `cli/smoke.html`: connect to WS, render output, send keys, resize
- [ ] Verify: `vim`/`nano`/`htop` render correctly

### Lifecycle
- [ ] Clean shutdown on client disconnect (session stays alive)
- [ ] SIGINT handler kills PTY gracefully

### Tests
- [ ] Integration test: WS client → PTY round-trip

**DoD:** type in browser → drives real shell; `vim`/`nano`/`htop` render correctly; resize propagates; close browser → reopen → session alive (PTY held by CLI process).

---

## Phase 2 — Secure Tunnel & Pairing
**Goal:** Public TLS URL with device-bound auth; QR pairing flow.

### Dev Tunnels Provisioning
- [ ] Microsoft Dev Tunnels app registration (anonymous auth) — manual external task

### Dev Tunnels Integration
- [ ] `cli/src/tunnel/devtunnels.ts`: Dev Tunnels client (anonymous auth) — `connect()` → URL, `disconnect()` (extract a `TunnelBackend` interface only if a second backend is built)
- [ ] CLI flag: `--tunnel devtunnels|local` (default: `devtunnels`)

### Auth & Pairing
- [ ] `cli/src/auth.ts`: generate short pairing code (6-8 alphanumeric, cryptorandom)
- [ ] HTTPS pairing endpoint at `/.well-known/mobily/pair`
- [ ] On pairing: validate code → receive Device Key (public key) → store `{ deviceId, publicKey, stationName, pairedAt }` → return `{ tunnelUrl, stationName, protocolVersion }`
- [ ] On reconnect: send nonce challenge → verify Device Key signature → accept/reject
- [ ] Pairing code burned after first successful bind

### Pairing Code Display
- [ ] Print pairing code to terminal as plain text (QR rendering deferred to Phase 3, when the phone scanner arrives)

### Version Negotiation
- [ ] `shared/protocol.ts`: add `hello` / `hello-ack` frame types
- [ ] `hello`/`hello-ack` frame exchange on WS connect
- [ ] Incompatible versions: send error message and close connection

### Tests
- [ ] Unit tests: auth/token lifecycle (mock tunnel)
- [ ] Integration test: pairing flow end-to-end
- [ ] Integration test: challenge-response auth

**DoD:** remote machine connects via tunnel URL and streams shell; unauthenticated connections refused; Device Key challenge-response works; unbound device rejected.

---

## Phase 3 — Basic Android App
**Goal:** Live terminal session from the phone with robust connection handling.

### Android Scaffold
- [ ] Expo SDK app shell (prebuild/dev-client, not Expo Go); add `android/` to `pnpm-workspace.yaml`
- [ ] Install `react-native-vision-camera`
- [ ] Verify: `pnpm android:prebuild` succeeds; dev-client builds and launches on device/emulator

### QR Scanner & Pairing
- [ ] `cli/src/qr.ts`: emit terminal QR encoding the short pairing code; verify renders cleanly in Windows Terminal, iTerm, VS Code
- [ ] `android/app/scanner/`: QR scanner via `react-native-vision-camera`
- [ ] Extract pairing code from QR
- [ ] HTTPS handshake with CLI pairing endpoint
- [ ] Receive connection payload (tunnel URL, station name, protocol version)

### Device Key Auth
- [ ] Install `react-native-biometrics`; rebuild dev-client
- [ ] `android/app/auth/`: Device Key management via `react-native-biometrics`
- [ ] On pairing: `createKeys()` → send public key to CLI
- [ ] On reconnect: receive nonce → `createSignature({ payload: nonce })` → send signature

### WebSocket Client
- [ ] `android/app/client/`: WS client with exponential backoff reconnect
- [ ] Device Key challenge-response in WS handshake
- [ ] `hello`/`hello-ack` version negotiation

### Terminal WebView
- [ ] `android/app/terminal/`: `WebView` hosting bundled `xterm.js`
- [ ] Bridge: `postMessage`/`injectedJavaScript`
- [ ] Phone-side output batching: accumulate WS data → flush on `requestAnimationFrame`
- [ ] Output frames → `term.write()`
- [ ] Input (keystrokes, paste) → WS `input` frame
- [ ] Resize → `term.resize()` → WS `resize` frame

### Extra Key Row
- [ ] Termux-style key row in WebView: `Esc | Ctrl | Alt | Tab | ← | → | ↑ | ↓`
- [ ] Ctrl/Alt as toggle buttons (arm → next keypress → auto-disarm)
- [ ] Soft keyboard + hardware keyboard support

### Latency Measurement
- [ ] Instrument keystroke-to-echo round-trip time
- [ ] Log P50/P95
- [ ] Document baseline latency with Dev Tunnels

### Connection State Machine
- [ ] Connection state: `disconnected → connecting → connected → reconnecting → failed`
- [ ] App resume triggers `reconnecting` if connection is lost (formal `foreground | background` state machine deferred to Phase 5, when the foreground service needs it)
- [ ] `connecting`: spinner + "Connecting to {stationName}..."
- [ ] `connected`: terminal view + green indicator
- [ ] `reconnecting`: overlay with attempt count, exponential backoff (1s→2s→4s→max 30s)
- [ ] `failed`: "Connection lost" + retry button + re-scan option

### Error UX
- [ ] Auth rejection: "Device not recognized — scan QR to re-pair"
- [ ] Station offline: "Station unreachable — is the CLI running?"
- [ ] Network change (wifi ↔ cellular): auto-reconnect
- [ ] Version mismatch: "Please update" message

### Data Model
- [ ] Persist current pairing as a single record in encrypted storage: `{ stationName, tunnelUrl, pairedAt }`
- [ ] Device Key stored in Android Keystore (per-station keypair)

### Tests
- [ ] Maestro: scan → connect → verify native UI states
- [ ] Maestro: error states render correct messages

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
