# Android terminal rash-test bugs

Status: ready-for-agent

## Summary

Aggressive real-device testing on a Xiaomi 24069PC21I running Android 16 reproduced three independent terminal interaction failures:

1. The terminal keyboard control cannot open the Android IME.
2. An abruptly terminated alternate-screen TUI can leave the shell without scrollback.
3. Mouse reports queued while a TUI is stalled can leak into the returning shell as literal text.

Each bug has a deterministic reproduction harness and captured evidence under:

`/home/kiran/code-wsl/playground/.test-evidence/aggressive-rash-test/`

The full testing report is:

`/home/kiran/code-wsl/playground/.test-evidence/aggressive-rash-test/report.md`

## Tickets

- `issues/01-restore-android-terminal-ime.md`
- `issues/02-recover-scrollback-after-abrupt-tui-exit.md`
- `issues/03-prevent-queued-mouse-report-leaks.md`

## Comments

These tickets are independent and can be implemented in parallel. No Mobily source files were changed while producing the reproductions.
