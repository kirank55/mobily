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
