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
- [x] `cli/src/tunnel/local.ts`: `LocalBackend` — initial LAN backend; upgraded to pinned TLS by Phase 3.1 with an explicit plaintext development override
- [x] Dev Tunnels helper resolver with PATH and platform-specific install-location discovery
- [x] Update ADR 0003 + plan.md: default→local, Dev Tunnels opt-in, correct anonymous-hosting assumption
- [x] Test (vitest): `cli/tests/tunnel.test.ts` — LocalBackend URL shape, bindHost, disconnect

### Dev Tunnels Integration

- [x] `cli/src/tunnel/devtunnels.ts`: guide official helper installation/login, host a temporary `--allow-anonymous` tunnel, return its `wss://` URL, and stop the helper on disconnect
- [x] GitHub or Microsoft device-code login through the official `devtunnel` helper; cached users skip login
- [x] `cli/src/tunnel/index.ts`: `createTunnelBackend(tunnelId)` factory + `isTunnelId()` type guard
- [x] CLI flag: `--tunnel local|devtunnels` wired in `index.ts` via `node:util.parseArgs`; Phase 3.1 removed the implicit local default
- [x] Test (vitest): local backend behavior plus guided Dev Tunnels install, login, hosting, retry, and shutdown

### Auth & Pairing

- [x] `cli/src/auth.ts`: generate short pairing code (6-8 alphanumeric, cryptorandom)
- [x] HTTPS pairing endpoint at `/.well-known/mobily/pair` (HTTP on local, TLS via Dev Tunnels ingress on remote)
- [x] On pairing: validate code → receive Device Key (public key) → store `{ deviceBindingId, publicKey, stationName, pairedAt }` → return `{ tunnelUrl, stationName, protocolVersion }`
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
- [x] Install and configure `expo-camera` for QR scanning
- [x] Verify: `pnpm android:prebuild` succeeds; dev-client builds and launches on device/emulator

### QR Scanner & Pairing

- [x] `cli/src/qr.ts`: emit terminal QR encoding the short pairing code; verify renders cleanly in Windows Terminal, iTerm, VS Code
- [x] `android/app/scanner/`: QR scanner via `expo-camera`
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
- [ ] Record measured Dev Tunnels P50/P95 on a physical device in `docs/latency-baseline.md`

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

- [x] Add Maestro flow definitions for scan/connect and error-state UX
- [ ] Run the Maestro flows against an installed app and live or controlled Station fixture

**DoD:** scan QR → paired → connected → type on phone → live output; reconnects after background → foreground; error states render correct messages; high-throughput output (`cat large_file`) doesn't drop frames; latency measured and documented (P50/P95).

---

## Phase 3.1 — Security Hardening

**Goal:** Make the terminal trust boundaries explicit and bounded before adding more privileged features.

- [x] Require explicit tunnel selection; permit plaintext LAN only with `--allow-insecure-local`, and reject it in the production Android flow
- [x] Encode a versioned, expiring Station endpoint and pairing code in the QR; reject malformed, expired, or substituted payloads
- [x] Require Device Key proof-of-possession over the Station endpoint, pairing code, binding ID, and public key before storing the binding or burning the code
- [x] Share WebSocket close codes and add an explicit `auth-ok` frame
- [x] Bound WebSocket payload size, connection count, handshake duration, resize/input sizes, and slow-client output buffering
- [x] Stop reflecting malformed wire payloads in errors
- [x] Bundle pinned xterm assets into the app, enforce CSP, block WebView navigation, validate bridge messages, and disable file/universal/mixed-content access

### Follow-up improvements

- [x] Consolidate the production `TerminalView.tsx` document and `dev/term.html` harness around one generated terminal document
- [x] Add an Android unit-test task covering QR parsing, pairing-response validation, exact close codes, auth readiness, reconnect scheduling, secure-transport rejection, storage parsing, and WebView bridge schemas
- [x] Persist Station-side Device Key bindings with restrictive filesystem permissions; add listing and explicit revocation
- [x] Replace the primitive `deviceId` string/`Math.random()` generator with a cryptographically generated branded Device Binding ID and align `CONTEXT.md` terminology
- [x] Audit README feature claims against the released tree and separate current capabilities from roadmap items
- [x] Add a TLS/pinned-certificate local backend so Android LAN use can be re-enabled without the insecure development override
- [x] Disposition the transitive `uuid <11.1.1` audit advisory: no compatible Expo/xcode upgrade exists as of 2026-07-14, the affected API is outside runtime paths, and forcing an incompatible major is prohibited; monitor `docs/security-audit.md`

**DoD:** production phone flows use authenticated encrypted transport; pairing is endpoint-bound and proof-of-possession protected; anonymous resource use is bounded.

---

## Phase 4 — Structured Git Features

**Goal:** Native Git GUI without reading raw terminal.

### Protocol Extension

- [x] `shared/protocol.ts`: add `rpc` request/response frames

### Git RPC Handlers

- [x] `cli/src/git/service.ts`: `simple-git` file status as JSON
- [x] `cli/src/git/service.ts`: `simple-git` commit log as JSON
- [x] `cli/src/git/service.ts`: `simple-git` branch list/switch
- [x] `cli/src/git/service.ts`: `simple-git` stage/unstage files
- [x] `cli/src/git/service.ts`: `simple-git` commit with message
- [x] `cli/src/git/service.ts`: raw `git diff` spawn → chunked `rpc-stream` frames (`{ type, id, chunk, done }`)

### Android Git UI

- [x] `android/src/git/`: file list (virtualized)
- [x] Unified diff view
- [x] Side-by-side diff view
- [x] Branch picker
- [x] Commit dialog

### Host List UI

- [x] Generalize pairing storage from single record to list: `[{ stationName, tunnelUrl, pairedAt }]`
- [x] `android/src/hosts/`: Station list screen
- [x] Station name, last connected, status indicator (online/offline)
- [x] Switch between stations without re-scanning

### Tests

- [x] vitest: Git RPC handlers (temporary real Git repositories)
- [x] Define the Maestro host-list navigation flow
- [ ] Run the host-list flow against a test build seeded with two Station pairings and Device Keys

**DoD:** browse changes, stage, commit from phone without terminal; large diffs (1000+ lines) render without jank; switch between multiple paired stations.

---

## Phase 5 — Polish & Backgrounding

**Goal:** Native-feeling persistence + background alerts.

### SessionBackend Abstraction

- [x] `cli/src/mux/types.ts`: `SessionBackend` interface
- [x] `cli/src/mux/bare.ts`: `BareBackend` — extract the Phase 1 inline bare behavior (PTY held by CLI process) behind the interface
- [x] `cli/src/mux/tmux.ts`: `TmuxBackend` — wrap PTY in `tmux` for crash survival; create named session, reattach on reconnect
- [x] Auto-detect: use `TmuxBackend` if `tmux` on `$PATH`, else `BareBackend`
- [x] Refactor `session.ts` to use `SessionBackend` instead of holding `PtyProcess` directly

### Shared Android + Workstation Terminal

- [x] Attach Mobily's PTY to the named tmux session used by Android instead of creating an Android-only shell
- [x] Attach the launching interactive CLI console directly to the shared session with scrollback-before-live ordering
- [x] Stream exact PTY output to Android and the embedded workstation terminal; accept input from either client
- [x] Reserve Ctrl+C for Mobily shutdown and map Ctrl+X to a shared-session interrupt
- [x] Make workstation dimensions authoritative while the embedded terminal is active
- [x] Print an exact workstation attach command such as `tmux attach -t mobily-<session>` for an optional additional client
- [x] Define session naming/selection, reuse, detach/terminate behavior, and stale-session cleanup
- [x] Define shared-window resize behavior for differently sized Android and workstation clients
- [x] Explain the `BareBackend` limitation when tmux is unavailable: embedded mirroring works, but persistence and additional attachment do not

### Scrollback Replay

- [x] `TmuxBackend`: replay last N lines via `tmux capture-pane` on reconnect
- [x] `BareBackend`: in-process ring buffer → replay on reconnect

### WebSocket Alerts

- [x] `shared/protocol.ts`: add `alert` frame type
- [x] CLI: detect agent prompt / idle-timeout via PTY output heuristics
- [x] Send `{ type: "alert", message }` frame over WS
- [x] Android: foreground service updates notification with alert content

### Foreground Service

- [x] `android/src/foreground/foreground.ts`: keep WS alive in background
- [x] Ongoing notification: connection status + last terminal line + agent alerts

### Reconnect Polish

- [x] On app resume: re-auth (Device Key) → reattach session → replay scrollback
- [x] Survive network changes transparently

### Tests

- [x] vitest: scrollback replay (both backends)
- [x] vitest: embedded workstation replay/live output, input controls, resize authority, cleanup, and non-TTY fallback
- [x] Define Maestro flow: background → foreground → reconnected
- [x] Define Maestro flow: notification shows alert content and opens Mobily
- [ ] Run both Phase 5 Maestro flows on an API 26+ device/emulator with a live Station fixture
- [ ] Accept simultaneous Android/workstation control, CLI-crash reattachment, and a long background/network-change session on device

**DoD:** Android and the embedded workstation terminal display and control the same session; commands entered on either client are visible on both; agent prompt → notification → user opens app → responds → agent continues; long sessions survive backgrounding + network changes; with tmux, sessions survive CLI crash; works on API 26+.
