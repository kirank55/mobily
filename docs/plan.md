# mobily — Plan

## Locked Decisions

- **Tunneling:** Pluggable `TunnelBackend` interface with explicit selection — pinned-TLS `LocalBackend` for account-free LAN use; Dev Tunnels as the secure remote path; alternatives (Bore, Cloudflare, SSH) via `--tunnel`
- **App platform:** Android, React Native (Expo + prebuild workflow), target latest API (36+), with fallbacks for older versions
- **Terminal renderer:** `xterm.js` inside a React Native `WebView`, with Termux-style extra key row (Esc, Ctrl, Alt, Tab, arrows) implemented in the WebView layer
- **Lock-screen surface:** Foreground-service notification (all API 26+ devices)
- **Wire protocol:** JSON (schemas in `shared/`); binary frames deferred unless profiling demands it
- **Session persistence:** `SessionBackend` interface — `TmuxBackend` (macOS/Linux/WSL) or `BareBackend` (Windows without tmux)
- **AI agent integration:** pure PTY passthrough (no agent-specific coupling)
- **Repo:** pnpm + turbo monorepo (`cli/`, `android/`, `shared/`) — introduced incrementally (Phase 0 is a standalone `cli/`; the workspace + turbo arrive in Phase 1 when `shared/` is first needed; `android/` joins in Phase 3)
- **Auth model:** Device Key — `react-native-biometrics` keypair in Android Keystore; challenge-response on every reconnect; no session tokens
- **Alerts:** WebSocket-based (foreground service updates notification); no FCM dependency
- **License:** MIT

## Phases

### Phase 0 — CLI Scaffold

**Goal:** A standalone `cli/` package builds green. Nothing functional yet.

- `cli/`: TypeScript, eslint, prettier, tsup, `bin` entry for `npx mobily`; stub `main()` that prints version only
- MIT `LICENSE` at repo root
- **DoD:** `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm build` (in `cli/`) all succeed
- **Note:** No monorepo tooling, no `shared/`, no `android/`, no `node-pty` yet — each arrives in the phase that first needs it.

### Phase 1 — Proof of Concept CLI (PTY + WebSocket)

**Goal:** Local terminal streaming on the CLI with session persistence, validated from a browser.

- **Monorepo setup:** `pnpm-workspace.yaml` (`cli`, `shared`), `turbo.json`, point CI at turbo pipelines. (This is when the repo becomes a monorepo — `shared/` is first needed here.)
- `shared/protocol.ts`: frame types — `input`, `output`, `resize`, `eof` (version-negotiation `hello`/`hello-ack` frames are deferred to Phase 2). Scaffold vitest + unit tests for encode/decode.
- **`PtyBackend` interface:** define `spawn()`, `write()`, `onData()`, `resize()`, `kill()` — implement `NodePtyBackend` using `node-pty`. This abstraction protects against `node-pty` breakage on Node.js upgrades.
  - Pin `node-pty` to `1.1.0` (prebuild-enabled); validate native build on Windows without VS Build Tools. If build fails, evaluate `@homebridge/node-pty-prebuilt-multiarch` or Bun's built-in PTY as alternative `PtyBackend` implementations. Resolve before building the WebSocket server.
  - CI matrix: win/mac/linux `node-pty` build. Scaffold vitest in `cli/`.
- `cli/src/ws.ts`: `ws` server on `localhost:<port>`
- `cli/src/session.ts`: glue PTY ↔ WS, encode/decode frames; hold the `PtyProcess` directly so the session survives WS disconnects (bare behavior). The `SessionBackend` abstraction + `TmuxBackend` are deferred to Phase 5 — tmux's benefit (crash survival) isn't exercised until then.
- Browser smoke page (`cli/smoke.html`): connect, render, send keys, resize
- Clean shutdown on disconnect; SIGINT handler kills PTY
- Integration test: WS client → PTY round-trip
- **DoD:** type in browser → drives real shell; `vim`/`nano`/`htop` render correctly; resize propagates; close browser → reopen → session still alive (PTY held by CLI process)
- **Risks:** `node-pty` native module — resolved in this phase via `PtyBackend` abstraction + prebuilt binary pin.

### Phase 2 — Secure Tunnel & Pairing

**Goal:** Public/LAN URL with device-bound auth; QR pairing flow.

- **Explicit local tunnel (LAN)** — `LocalBackend` binds WSS to `0.0.0.0`, persists a self-signed Station identity, and carries its SPKI pin in the pairing QR. The plaintext form requires the insecure-development override.
- **Dev Tunnels: opt-in remote** (`--tunnel devtunnels`) — Mobily guides installation of Microsoft's official `devtunnel` helper and offers GitHub or Microsoft device-code login. The helper caches credentials. The tunnel is opened with `--allow-anonymous`; the phone proves identity with its Device Key.
  - First-run helper installation and account login — see `docs/devtunnels-provisioning.md`.
  - **Note:** Dev Tunnels cannot be hosted anonymously — only connecting to a tunnel can be anonymous. This corrects the original ADR 0003 assumption.
- `cli/src/tunnel/`: `TunnelBackend` interface — `connect(localPort)` → `TunnelConnection { url, disconnect() }`, plus `bindHost`
  - `LocalBackend`: account-free pinned-TLS LAN mode; optional plaintext browser-development override
  - `DevTunnelsBackend`: opt-in remote — orchestrates the official `devtunnel` helper and its cached login
  - Document how to add alternative backends (Bore, Cloudflare, SSH)
  - CLI flag: `--tunnel local|devtunnels` (required; no implicit default)
- `cli/src/auth.ts`:
  - Generate short pairing code (6-8 alphanumeric chars, cryptorandom)
  - Expose HTTPS pairing endpoint at `/.well-known/mobily/pair`
  - On pairing request: validate pairing code, receive Device Key (public key from Android Keystore), store `{ deviceBindingId, publicKey, stationName, pairedAt }`, return `{ tunnelUrl, stationName, protocolVersion }`
  - On reconnect: send nonce challenge → verify Device Key signature → accept or reject
  - Pairing code burned after first successful bind
- `cli/src/qr.ts`: emit terminal QR encoding only the short pairing code (tiny QR, renders in any terminal)
- **Version negotiation:** add `hello`/`hello-ack` frame types to `shared/protocol.ts`; on WebSocket connect, CLI and client exchange `{ type: 'hello', protocolVersion }`. Incompatible versions show "Please update" message.
- Tests: auth/token lifecycle (mock tunnel), pairing flow end-to-end, challenge-response auth
- **DoD:** `wscat -c "wss://..." -H "auth:..."` from a remote machine streams the shell; unauthenticated connections are refused; Device Key challenge-response works; connect from unbound device is rejected
- **Risks:** Dev Tunnels latency overhead — measured in Phase 3 (needs an interactive client). Anonymous tunnel limitations — test rate limits and session lifetime.
- **Note:** Latency instrumentation is deferred to Phase 3 — Phase 2's test client is `wscat`/`curl`, which can't measure keystroke-to-echo cleanly.

### Phase 3 — Basic Android App

**Goal:** Live terminal session from the phone with robust connection handling.

- **Android scaffold:** Expo SDK app shell (prebuild/dev-client, not Expo Go — needs native modules for `react-native-biometrics` and camera); add `android/` to `pnpm-workspace.yaml`; install `react-native-biometrics`, `react-native-vision-camera`. (This is when `android/` joins the monorepo.)
- `android/app/scanner`: QR scanner via `react-native-vision-camera` → extract pairing code → HTTPS handshake with CLI pairing endpoint
- `android/app/auth`: Device Key management via `react-native-biometrics`:
  - On pairing: `createKeys()` → send public key to CLI pairing endpoint
  - On reconnect: receive nonce from CLI → `createSignature({ payload: nonce })` → send signature (biometric prompt on each reconnect = session-hijack protection)
- `android/app/client`: WebSocket client with exponential backoff reconnect, Device Key challenge-response auth, `hello`/`hello-ack` version negotiation
- `android/app/terminal`: `WebView` hosting a bundled `xterm.js` bundle; bridge RN↔WebView via `postMessage`/`injectedJavaScript`
  - **Phone-side output batching:** accumulate incoming WS data and flush to `term.write()` on `requestAnimationFrame`. Auto-adapts to device refresh rate (60/90/120Hz). CLI sends output eagerly — no server-side batching.
  - Output frames → `term.write()`
  - Input (keystrokes, paste) → WS `input` frame
  - Resize → `term.resize()` → WS `resize` frame
  - **Extra key row** (Termux-style): `Esc | Ctrl | Alt | Tab | ← | → | ↑ | ↓` implemented in the WebView above xterm.js. Ctrl/Alt are toggle buttons (tap to arm, auto-disarm after next keypress).
- Soft keyboard + hardware keyboard support
- **Latency measurement:** instrument keystroke-to-echo round-trip time; log P50/P95; document baseline latency with Dev Tunnels; tune batch interval against the real interactive client. (Lives here — needs the app to measure.)
- Persist the current pairing as a **single record** in encrypted storage: `{ stationName, tunnelUrl, pairedAt }`. (The list/multi-station model arrives in Phase 4 with the host-list UI.)
- Device Key stored in Android Keystore (per-station keypair)

#### Connection State Machine

Two independent state machines:

**Connection state:** `disconnected → connecting → connected → reconnecting → failed`

- `connecting`: show spinner + "Connecting to {stationName}..."
- `connected`: terminal view, subtle green indicator
- `reconnecting`: show overlay "Reconnecting..." with attempt count; exponential backoff (1s, 2s, 4s, max 30s)
- `failed`: after N retries, show "Connection lost" with manual retry button + option to re-scan QR

**App lifecycle state:** `foreground | background`

- On `background → foreground`: if connection is `connected`, resume terminal; if `disconnected`, transition connection to `reconnecting`; reattach the session held by the CLI

**Error UX** (function of both states):

- Auth rejection: "Device not recognized — scan QR to re-pair"
- Station offline / tunnel down: "Station unreachable — is the CLI running?"
- Network change (wifi ↔ cellular): auto-reconnect transparently
- Version mismatch: "Please update the Mobily app" / "Please update the CLI"

- **DoD:** scan QR → paired → connected → type on phone → live output; reconnects after brief background→foreground; error states render correct messages; high-throughput output (`cat large_file`) doesn't drop frames; latency measured and documented (P50/P95)
- **Risks:** xterm-in-WebView perf — mitigated by phone-side batching; profile and tune batch interval in this phase

### Phase 4 — Structured Git Features

**Goal:** Native Git GUI without reading raw terminal.

- `shared/protocol.ts`: extend with `rpc` request/response frames and `rpc-stream` chunked response frames (`{ type, id, chunk, done }`) — added here, the first phase that needs structured RPC.
- `cli/src/git/`: JSON-RPC handlers:
  - `simple-git` for: `status`, `log`, `branch`, `stage`, `unstage`, `commit`
  - Raw `git diff` spawned directly (not via `simple-git`) — stream stdout in chunks as `{ type: "rpc-stream", id, chunk, done }` frames to handle large diffs without memory blowup
- `android/app/git/`: file list, unified diff view, side-by-side diff view, branch picker, commit dialog
- Virtualized list for large file lists and diffs; cap diff payload with pagination
- `android/app/hosts/`: host list screen — generalize pairing storage from a single record to a **list** `[{ stationName, tunnelUrl, pairedAt }]`; station name, last connected, status indicator (online/offline); switch between stations without re-scanning (Device Keys persist per station)
- **DoD:** browse changes, stage, and commit from the phone without touching the terminal view; large diffs (1000+ lines) render without jank; switch between multiple paired stations
- **Risks:** large diff rendering in RN — virtualize the list, cap payload size; `simple-git` error edge cases — add error boundaries

### Phase 5 — Polish & Backgrounding

**Goal:** Native-feeling persistence + background alerts.

- **SessionBackend abstraction:** introduce the `SessionBackend` interface with two implementations (this is when a second behavior — tmux crash survival — is first needed):
  - `BareBackend`: extract the Phase 1 inline bare behavior (PTY held by CLI process) behind the interface.
  - `TmuxBackend`: wrap PTY in a named `tmux` session so the session survives CLI crashes — on reconnect, reattach; on first connect, create the session.
  - Auto-detect: use `TmuxBackend` if `tmux` is on `$PATH`, otherwise fall back to `BareBackend`.
  - Refactor `session.ts` to use `SessionBackend` instead of holding `PtyProcess` directly.
- **Shared Android + workstation terminal:** expose the session backend to an embedded interactive CLI terminal instead of creating an Android-only shell.
  - Attach Mobily's PTY to the named tmux session for Android input/output streaming.
  - Replay and stream raw PTY output into the launching CLI, and forward its input back to the same backend.
  - Print the exact workstation command (for example, `tmux attach -t mobily-<session>`) for an optional additional terminal.
  - Android and workstation clients receive the same output and may enter commands; commands entered on either side must be visible on the other.
  - Define session naming/selection, whether an existing Mobily session is reused, detach versus terminate behavior, and cleanup of stale sessions.
  - Define shared-window resize behavior so Android resizing does not make the workstation terminal unusable.
  - When tmux is unavailable, retain embedded mirroring while the CLI lives and explain that persistence and additional terminal attachment require tmux.
- `cli/src/mux/`: enhance both backends with scrollback replay on reconnect:
  - `TmuxBackend`: replay last N lines via `tmux capture-pane`
  - `BareBackend`: replay from in-process ring buffer
- **WebSocket-based alerts:** add an `alert` frame type to `shared/protocol.ts`; when the CLI detects an agent prompt or idle-timeout (via PTY output heuristics), send an `{ type: "alert", message }` frame over the existing WebSocket. The foreground service updates the ongoing notification with the alert content. No FCM, no push service dependency.
- **Foreground service:** `android/app/foreground.ts` — keeps WS alive in background; ongoing notification showing connection status + last terminal line + agent alerts
- Reconnect strategy on app resume: re-auth (Device Key challenge-response), reattach session, replay scrollback
- **DoD:** commands and output are visible in the same terminal on Android and the embedded workstation console; input from either client drives that shared session; agent prompts for a token → notification shows the prompt → user opens app → responds → agent continues; long sessions survive backgrounding + network changes; with tmux, sessions survive CLI crash; works on API 26+
- **Risks:** Foreground service battery impact — minimize wake-locks; rely on WS keep-alive pings rather than polling

## Multi-Machine Support

- Pairing model supports multiple stations: each QR scan creates a named station entry in encrypted storage with its own Device Key
- `android/app/hosts/`: host list screen — station name, last connected, status indicator (online/offline)
- Switch between stations without re-scanning (Device Keys persist per station)
- **Phase 3:** data model stores a single pairing record (only one station is paired at a time in that phase's flow). **Phase 4:** generalize storage to a list and add the host-list UI.

## Latency Budget

- **Target:** < 100ms keystroke-to-echo round-trip (for "local terminal" feel)
- **Breakdown:** phone input → WS frame (~5ms) → Tunnel relay (~50-150ms) → CLI PTY echo → WS frame → phone render (~5ms)
- **Measurement:** instrumented in Phase 3 (needs the interactive Android client), log P50/P95, tune batching in the same phase
- **Future optimization:** local echo (optimistic keystroke display à la Mosh) — deferred until real latency is measured; only add if P95 exceeds target

## Testing Strategy

| Layer                                                      | Tool                                                     | Phase |
| ---------------------------------------------------------- | -------------------------------------------------------- | ----- |
| Protocol types (encode/decode)                             | vitest unit tests                                        | 1     |
| WS + PTY pipeline                                          | vitest integration tests (spawn real PTY, assert frames) | 1     |
| Auth / Device Key lifecycle                                | vitest unit tests (mock tunnel)                          | 2     |
| Android native UI flows (scan, connect, errors, host list) | Maestro                                                  | 3+    |
| Git RPC handlers                                           | vitest unit tests (mock git repo)                        | 4     |
| Reconnect / error recovery                                 | vitest integration tests + Maestro flows                 | 3–5   |

> **Note:** Maestro cannot interact with xterm.js inside the WebView. Terminal rendering correctness is trusted to xterm.js (battle-tested). If WebView-specific testing is later needed, add Playwright tests for the standalone xterm bundle.

## Cross-Cutting Risks / Notes

- **node-pty native binaries:** `PtyBackend` abstraction protects against breakage; validated in Phase 1 (not Phase 0); CI matrix for win/mac/linux in Phase 1
- **Dev Tunnels rate/quotas:** confirm anonymous-connect tier covers dev use; `TunnelBackend` interface allows switching to alternatives. Dev Tunnels is selected with `--tunnel devtunnels`; account-free LAN use is selected with `--tunnel local`
- **xterm.js ↔ RN bridge throughput:** phone-side `requestAnimationFrame` batching from Phase 3 onwards; profile batch interval
- **Foreground service as default lock-screen surface:** ensures compatibility with API 26+; no Live Updates dependency
- **Security:** Device Key auth model — keypair generated in Android Keystore (hardware-backed, non-extractable); CLI verifies via challenge-response on every reconnect; no session tokens; pairing code is one-time
- **tmux on Windows:** optional — `BareBackend` handles Windows natively (both backends arrive in Phase 5); tmux available via WSL if desired
- **Multi-machine:** data model is a single record in Phase 3; generalized to a list + host-list UI in Phase 4
- **Incremental monorepo:** Phase 0 ships a standalone `cli/`; `shared/` + pnpm workspaces + turbo arrive in Phase 1; `android/` joins in Phase 3. Each tool/package is introduced only when first needed.
- **Session abstraction timing:** Phase 1 holds the `PtyProcess` directly (bare behavior, survives WS disconnect). The `SessionBackend` interface + `TmuxBackend` arrive in Phase 5, when tmux's crash-survival benefit and scrollback replay are first exercised.
- **FOSS considerations:** no proprietary service dependencies required — tunneling is pluggable, alerts use WebSocket (no FCM), auth uses device-local Keystore (no cloud service)
