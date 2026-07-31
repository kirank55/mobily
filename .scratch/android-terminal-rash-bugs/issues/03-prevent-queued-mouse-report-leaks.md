# Prevent queued terminal mouse reports from leaking into the shell

Status: ready-for-agent

## What to build

Prevent terminal mouse-report packets generated while a mouse-enabled TUI is stalled from becoming literal shell input when that TUI exits or is killed. The process-boundary handling must cover packets already queued before the Mobily shell prompt appears, not only pointer events generated afterward.

Normal mouse clicks, hover handling, and swipe-to-wheel behavior must continue working while a TUI legitimately owns mouse reporting.

## Acceptance criteria

- [ ] Pointer movement while a TUI is stalled cannot produce literal SGR mouse strings in the returning shell.
- [ ] Killing a stalled mouse-enabled TUI leaves a clean, empty shell prompt.
- [ ] No queued mouse packet can execute or modify a shell command after the process boundary.
- [ ] Mouse clicks and swipe-generated wheel packets still reach an active mouse-enabled TUI.
- [ ] Future pointer events remain suppressed after the Mobily shell prompt clears mouse mode.
- [ ] A regression test queues mouse movement before the prompt/process exit and verifies that the shell receives no mouse-report input.
- [ ] Clean and abrupt TUI exits are both covered.

## Blocked by

None - can start immediately.

## Comments

Deterministic reproduction:

`/home/kiran/code-wsl/playground/.test-evidence/aggressive-rash-test/hover-string-repro.ps1`

Observed shell input:

```text
35;5;3M35;18;14M35;33;5M35;46;16M...
```

Supporting report:

`/home/kiran/code-wsl/playground/.test-evidence/aggressive-rash-test/report.md`
