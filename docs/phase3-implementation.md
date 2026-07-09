# Phase 3 — Basic Android App: Implementation Plan

> Stacked-branch implementation of Phase 3 (`docs/tasks.md` lines 109–175).
> Each branch is based on the previous one; each gets a PR.
> Generated from a planning conversation and locked decisions.

## Locked decisions

1. **Expo prebuild + dev-client (not Expo Go)** — `react-native-vision-camera` and
   `react-native-biometrics` require native modules Expo Go can't load. `android/`
   joins the pnpm workspace in this phase (incremental-monorepo decision,
   `plan.md` line 11). Expo Go is explicitly rejected.
2. **QR encodes only the short pairing code** — tiny QR, renders in any terminal
   (`plan.md` line 57). The CLI prints the QR *and* keeps the plain-text code as a
   fallback for terminals without QR support; the smoke-test URL still prints.
   **Library: `qrcode`** (`QRCode.toString(code, { type: 'terminal', small: true })`)
   + `@types/qrcode`. Chosen over `qrcode-terminal` (unmaintained; its `small`
   mode emits colorless block chars that render *inverted* on dark themes —
   unreliable for scanning). `qrcode`'s `small` mode forces a white background
   (`[47m[30m`) so the QR scans reliably on any terminal theme, is actively
   maintained, and supports other output types (future-proof).
3. **Biometric prompt on every reconnect** — `react-native-biometrics`
   `createSignature` triggers a prompt each connect/reconnect; accepted UX trade
   for session-hijack protection (ADR 0001). No "trust this session" toggle in
   Phase 3.
4. **Phone-side output batching via `requestAnimationFrame`** — CLI sends
   `output` frames eagerly; the phone accumulates and flushes to `term.write()`
   on rAF (auto-adapts to 60/90/120Hz). No server-side batching (`plan.md` line 73).
5. **Single pairing record in Phase 3** — `{ stationName, tunnelUrl, pairedAt }`
   in encrypted storage; the list/multi-station model + host-list UI are deferred
   to Phase 4 (`plan.md` lines 80, 136). Device Key is per-station in Android
   Keystore.
6. **App lifecycle = foreground/background only** — formal lifecycle state
   machine deferred to Phase 5 (when the foreground service needs it). Phase 3
   just reconnects on resume if the connection dropped (`tasks.md` line 155).
7. **Dev harnesses live in `android/dev/`** — mirrors the `cli/dev/` rule
   (`tasks.md` lines 8–12); production `files` exclude `dev/`.
8. **Maestro for native UI flows; xterm-in-WebView trusted to xterm.js** —
   Maestro can't drive WebView content; terminal rendering correctness is
   verified via `android/dev/` harnesses + manual checks (`plan.md` line 154).
   Maestro covers native UI states (scanner, connection states, error overlays).

## Stacked-branch plan

| # | Branch | Deliverables | Verification |
|---|---|---|---|
| 1 | `phase3/1-android-scaffold-qr` | `android/` joins `pnpm-workspace.yaml`; Expo SDK app shell via prebuild/dev-client; install `react-native-vision-camera` + `react-native-biometrics`; `turbo.json` tasks (`android:prebuild`, `android:build`); `android/` TS + eslint config; `cli/src/qr.ts` — terminal QR via `qrcode` (`{ type: 'terminal', small: true }`) encoding only the pairing code, wired into `index.ts` replacing the "QR arrives in Phase 3" line, plain-text code kept as fallback; check off `tasks.md` items as they land | `pnpm typecheck lint build test` green (cli + shared); `pnpm android:prebuild` succeeds; dev-client builds + launches on device/emulator; **Manual**: run `npx mobily`, verify QR renders in Windows Terminal, iTerm, VS Code (plain-text fallback on dumb terminals); `cli/dev/smoke.html?port=…` still pairs + streams (CLI-side regression) |
| 2 | `phase3/2-scanner-pairing` | `android/app/scanner/` — QR scanner via `react-native-vision-camera` → extract pairing code; `android/app/auth/` — Device Key via `react-native-biometrics` (`createKeys()` on pair, biometric prompt) → send public key to CLI; HTTPS POST to `/.well-known/mobily/pair` → receive `{ tunnelUrl, stationName, protocolVersion }` | `pnpm typecheck lint` green (`android/`); `pnpm build` (cli + shared); **Manual**: scan CLI's QR with phone → biometric prompt for key creation → CLI logs the bind → phone receives connection payload; wrong/expired code → CLI rejects (parity with `cli/dev/smoke.html`) |
| 3 | `phase3/3-ws-client` | `android/app/client/` — WS client with exponential backoff (1s→2s→4s→max 30s); `hello`/`hello-ack` version negotiation + `auth-challenge`/`auth-response` (sign nonce via `createSignature` — biometric prompt on each connect/reconnect); incompatible versions → "Please update" message | `pnpm typecheck lint` green (`android/`); **Manual**: after pairing, WS connects → handshake completes (debug log); kill CLI → observe backoff/reconnect; restart CLI → reconnect with biometric prompt; version mismatch → "Please update"; handshake parity with `cli/dev/smoke.html` |
| 4 | `phase3/4-terminal-webview` | `android/app/terminal/` — `WebView` hosting a bundled `xterm.js` (+ fit addon) as a static asset; RN↔WebView bridge via `postMessage`/`injectedJavaScript`; phone-side output batching (accumulate WS `output` → flush `term.write()` on rAF); `output`→`term.write`, input/paste→WS `input`, resize→`term.resize`→WS `resize`; `android/dev/term.html` — dev harness loading the same xterm bundle, fed simulated `output` frames (incl. `cat large_file`-style high throughput + ANSI) to verify rendering + batching in isolation (mirrors `cli/dev/smoke.html`) | `pnpm typecheck lint` green (`android/`); **Manual**: `android/dev/term.html` renders output + batching under high throughput; in-app connected terminal: `vim`/`nano`/`htop` render, keystrokes echo, resize propagates; `cat large_file` doesn't drop frames |
| 5 | `phase3/5-key-row-latency` | Termux-style extra key row in the WebView above xterm.js: `Esc \| Ctrl \| Alt \| Tab \| ← \| → \| ↑ \| ↓`; Ctrl/Alt as toggle buttons (arm → next keypress → auto-disarm); soft + hardware keyboard; latency instrumentation — keystroke-to-echo RTT (tag `input` frames, measure echo on `output`), log P50/P95; `android/dev/latency.html` (or instrumentation in the term harness) to capture baseline; `docs/latency-baseline.md` — P50/P95 with Dev Tunnels + LAN | `pnpm typecheck lint` green (`android/`); **Manual**: use key row in `vim`/`htop` (Ctrl+C, Tab, arrows, Esc); record + commit baseline latency numbers; high-throughput output still smooth |
| 6 | `phase3/6-state-errors-storage-tests` | Connection state machine `disconnected → connecting → connected → reconnecting → failed` with per-state UI (spinner/"Connecting to {stationName}…", green indicator, reconnecting overlay w/ attempt count, "Connection lost" + retry + re-scan); app resume → `reconnecting` if connection lost (formal fg/bg state machine deferred to Phase 5); error UX — auth rejection, station offline, network change (wifi↔cellular) auto-reconnect, version mismatch; persist single pairing record in encrypted storage (`expo-secure-store` or equiv) `{ stationName, tunnelUrl, pairedAt }`; Device Key per-station in Android Keystore; Maestro flows `android/e2e/scan-connect.yml` + `android/e2e/errors.yml` | `pnpm typecheck lint build test` green (cli + shared); Maestro flows pass on device/emulator; **Manual (full Phase 3 DoD)**: scan QR → paired → connected → type on phone → live output; background → foreground → reconnects; error states render correct messages; `cat large_file` doesn't drop frames; latency documented (P50/P95) |

## Execution workflow

For each branch:

1. Create the branch from the previous one (branch 1 from `main`).
2. Implement the deliverables.
3. Run `pnpm typecheck lint build test` (via turbo) until green; for `android/`,
   also `pnpm android:prebuild` + dev-client build.
4. Commit (commit message style matches the Phase 1/2 history:
   `implement <section name>`).
5. Push to `origin`.
6. Open a PR.

Each branch checks off its `docs/tasks.md` checkboxes as items land.

## Manual testing

Phase 3 is the first phase with a real interactive client, so manual verification
carries most of the DoD weight (the Android UI can't be unit-tested the way the
CLI is). Dev-only harnesses — kept out of production source — drive this:

- **`cli/dev/smoke.html`** (existing) — remains the **CLI-side regression
  harness** through Phase 3. It exercises pairing → WS handshake → terminal
  streaming in a browser without the phone, and is the **parity reference** for
  the Android client's handshake/auth behavior (branches 2–3 must match it).
  Open `cli/dev/smoke.html?port=<port>` from the URL the CLI prints.
- **`android/dev/term.html`** (new, branch 4) — direct analog of `smoke.html` for
  the terminal layer: loads the same xterm bundle the WebView uses and feeds it
  simulated `output` frames (including `cat large_file`-style high throughput and
  ANSI) to verify rendering + rAF batching **in isolation**, before the full RN
  app is involved.
- **`android/dev/latency.html`** (new, branch 5) — keystroke-to-echo RTT
  instrumentation to capture the P50/P95 baseline against both `--tunnel local`
  and `--tunnel devtunnels`.
- **On-device manual checks** — render checks (`vim`/`nano`/`htop`, resize,
  `cat large_file`), key row behavior, biometric prompts, background→foreground
  reconnect, and the four error UX states. These run on a real device or emulator
  via the dev-client built in branch 1.

> Dev harnesses live under `android/dev/` and `cli/dev/` only; production
> `files` exclude `dev/` (`tasks.md` lines 8–12).

## Notes / risks

- **xterm-in-WebView throughput** — mitigated by rAF batching; profile + tune the
  batch interval in branches 4–5 against the real interactive client. The
  `android/dev/term.html` harness gives an isolated perf signal before the full
  app is wired.
- **Biometric prompt friction on reconnect** — accepted per ADR 0001; every
  reconnect is a fresh challenge (session-hijack protection). A "trust this
  session for N minutes" toggle is a future nicety, out of Phase 3 scope.
- **Maestro can't drive the WebView** — terminal rendering correctness is
  verified via `android/dev/term.html` + manual checks, not Maestro. Maestro
  covers native UI states (scanner, connection states, error overlays) only.
- **`cli/dev/smoke.html` stays the CLI-side regression + parity reference** —
  branches 2–3 must match its handshake/auth behavior exactly.
- **Real Dev Tunnels + Device-Key + biometric flows are manual** (need login + a
  real keypair + a physical device); CI runs Maestro on emulator where possible.
- **Expo prebuild native build needs Android SDK + JDK on the Station** — one-time
  dev setup; documented in branch 1.
- **Phase 3 DoD** (`tasks.md` line 175) is met by branch 6's manual + Maestro
  verification: scan → pair → connect → type → live output; background→foreground
  reconnect; error states render; high-throughput output doesn't drop frames;
  latency measured and documented (P50/P95).
