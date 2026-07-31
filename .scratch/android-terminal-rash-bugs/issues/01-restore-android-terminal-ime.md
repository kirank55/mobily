# Restore Android terminal IME activation

Status: ready-for-agent

## What to build

Make the terminal keyboard control reliably open the Android soft keyboard on a connected physical device. Focusing xterm's hidden textarea in JavaScript is not sufficient: the native WebView must become Android's served input view, and keyboard visibility state must reflect whether the system IME actually opened.

Preserve the existing behavior that swipes, pans, and pinches do not accidentally open the keyboard.

## Acceptance criteria

- [ ] Pressing **Show keyboard** from a connected terminal opens the Android IME.
- [ ] A terminal tap that resolves without becoming a swipe or pan can open the IME.
- [ ] The native WebView has a served input connection before the IME show request is considered successful.
- [ ] Hiding the IME and opening it again works repeatedly without navigating away from the terminal.
- [ ] Swipes, pans, pinches, and mouse-enabled TUI gestures do not open the IME.
- [ ] Real-device coverage verifies actual IME visibility rather than only checking the DOM active element.
- [ ] Existing terminal input, extra-key, zoom, and selection behavior remains covered.

## Blocked by

None - can start immediately.

## Comments

Deterministic reproduction:

`/home/kiran/code-wsl/playground/.test-evidence/aggressive-rash-test/keyboard-repro.ps1`

Observed Android state:

```text
POLL_01..08 mInputShown=false
Ignoring showSoftInput() as view=...RNCWebView... is not served.
mServedInputConnection=null
```

Supporting report:

`/home/kiran/code-wsl/playground/.test-evidence/aggressive-rash-test/report.md`

### 2026-07-31 — worktree `test/issue-1-c` CLI + Android attempt

Cloud worktree run tried to validate this ticket by running the Station CLI and
the Expo Android app (see
`.scratch/android-terminal-rash-bugs/issue-1-cli-android-test-report-c.md`).

- Official CLI reaches Dev Tunnel GitHub device-code login; no headless credentials.
- Local TLS WSS stand-in + emulator APK/Metro path were stood up; System UI / app
  ANRs under software emulation (`-accel off`, no KVM) blocked a stable paired
  terminal, so Show-keyboard / `mInputShown` acceptance was not verified.
- Native IME module unit/policy tests still pass in this worktree.
