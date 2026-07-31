# Issue 1 CLI + Android test report (`test/issue-1-c`)

Ticket: `.scratch/android-terminal-rash-bugs/issues/01-restore-android-terminal-ime.md`

Worktree: `/workspace/.worktrees/test-issue-1-c`  
Branch: `test/issue-1-c`

## Verdict

**Incomplete for real-device IME acceptance.** The Station CLI path and Android app were both exercised in this cloud VM, but the soft-keyboard acceptance criteria could not be confirmed end-to-end: Dev Tunnel login is interactive, and the software-emulated Android device (no `/dev/kvm`) repeatedly hit System UI / app ANRs before a stable paired terminal session was available.

## What ran

### Station CLI

- Built `@mobily/shared` + `mobily` in the worktree.
- Installed Microsoft `devtunnel` helper (`/home/ubuntu/.local/bin/devtunnel`).
- Official CLI start:

  ```text
  pnpm --filter mobily exec node dist/index.js --devtunnels-provider github --verbose
  ```

  Result: helper present; interactive GitHub device-code login required
  (`Browse to https://github.com/login/device and enter the code: …`). No cached
  Dev Tunnel credentials in this environment, so the shipped CLI Station could not
  finish provisioning a public `wss://*.devtunnels.ms` endpoint headlessly.

### Local WSS Station substitute (scratch harness)

Because the app refuses non-`wss` endpoints (`isSecureWebSocketUrl`), a local TLS
Station was started for emulator reachability via `10.0.2.2`:

- Harness: `.scratch/local-wss-station-entry.ts`
- Listener: `0.0.0.0:35153` with self-signed cert + SPKI pin
- Example pairing payload written to `/tmp/mobily-pair-url.txt` / `/tmp/mobily-station.json`
- QR generated for virtual camera (`/tmp/mobily-pair.png`, `/tmp/mobily-camera.png`)

This is **not** the production Dev Tunnel path; it only stands in for pairing/transport
so the Android terminal can be reached when tunnel login is unavailable.

### Android app

- Installed Android SDK cmdline-tools, platform-tools, emulator, API 34 google_apis image, NDK, CMake, build-tools.
- Created AVD `Mobily_API_34` (Pixel 6 / API 34). No KVM → launched with
  `-gpu swiftshader_indirect -accel off`.
- `expo prebuild` + `assembleDebug` succeeded.
- APK installed and launched on `emulator-5554`.
- Metro connected (`Android Bundled … expo-router/entry.js`); Expo developer menu and camera-permission UI were reached at least once.
- Emulator restarted with `-camera-back imagefile:/tmp/mobily-camera.png` for QR scan.
- Later reinstalls / System UI became unreliable (persistent ANR dialogs; `adb install` hung). Soft-keyboard / IME visibility checks were not reached.

### Supporting automated checks (same worktree)

Already green for the native IME module wiring:

```bash
pnpm --filter mobily-android exec vitest run \
  tests/terminalIme.test.ts \
  tests/terminalImeNativePolicy.test.ts
```

These confirm JS→native show/hide forwarding and that
`MobilyTerminalImeModule.kt` serves the WebView (`restartInput` / `showSoftInput` /
`isActive` / `not-served`) before treating show as success. They do **not** replace
real `mInputShown` / `mServedInputConnection` device evidence.

## Acceptance criteria status

| Criterion | Result in this run |
| --- | --- |
| Show keyboard opens Android IME | **Not verified** (never reached stable terminal UI) |
| Tap without swipe/pan can open IME | **Not verified** on device (gesture harness exists under `.scratch/run-terminal-gesture.mjs`) |
| Native WebView served before success | **Code/policy covered** by `terminalImeNativePolicy` |
| Hide/show repeatedly | **Not verified** |
| Swipes/pans/pinches do not open IME | **Not verified** on device |
| Real-device IME visibility (not only DOM focus) | **Blocked** — no physical device; emulator ANR under TCG |
| Existing terminal input/keys/zoom/selection coverage | Unit/browser suites available; full browser suite not re-run in this pass |

## Blockers for completing the CLI + Android loop here

1. **Dev Tunnel auth** — `devtunnel user login` needs an interactive GitHub/Microsoft device-code approval; AGENTS.md already notes Station e2e is not available headless.
2. **No KVM** — Android emulator CPU/GPU are fully software; System UI and Mobily repeatedly ANR; package manager installs stall.
3. **Pairing requirements** — app requires `wss://`, secure lock screen, and strong biometrics before Device Key pairing; emulator fingerprint enrollment + camera QR path were started but not completed under ANR load.
4. **`mobily://pair` deep link** — Expo Router reports `Unmatched Route`; pairing is camera-QR only today.

## How to finish this test on a capable host

On the WSL/device setup documented in `docs/development.md` / `docs/android-emulator.md` (or a physical Xiaomi / API 16 device as in the ticket):

```bash
# Terminal A
pnpm build && pnpm --filter mobily exec node dist/index.js

# Terminal B
pnpm --filter mobily-android android
```

Scan the CLI QR, open the terminal, then verify issue 1:

1. Tap **Show keyboard** → IME visible (`mInputShown=true`, served input connection).
2. Hide and show repeatedly without leaving the terminal.
3. Confirm taps open IME; swipes/pans/pinches do not.
4. Capture `adb shell dumpsys input_method` / the ticket’s `keyboard-repro.ps1` evidence.

Scratch helpers already present for that host:

- `.scratch/generate-issue1-emulator-qr.mjs`
- `.scratch/start-emulator.sh`
- `.scratch/build-android-device.sh`
- `.scratch/local-wss-station-entry.ts` (cloud/local TLS stand-in)

## Artifacts

- Screenshots under `/opt/cursor/artifacts/screenshots/` (emulator home, Expo launcher, developer menu, unmatched `mobily://pair` route, ANR dialogs).
- Station pairing JSON: `/tmp/mobily-station.json` (ephemeral).
- CLI login attempt log: `/tmp/cli-run-issue1.log`.
