# Prevent queued terminal mouse reports from leaking into the shell

Status: ready-for-agent

## Progress

- State: **bug reproduced in cloud; fix pending** (test-only branch, no source fix)
- Branch: `test/issue-3-c`
- Report: `.scratch/android-terminal-rash-bugs/issue-3-cli-test-report-c.md`
- Done:
  - Reproduced the leak deterministically over the real wire protocol (bare PTY bash + `Session` + `startServer` + `ws` client): `cli/tests/queuedMouseReports.integration.test.ts` with fixture `cli/tests/fixtures/stalled-mouse-tui.mjs`
  - Both abrupt (SIGKILL) and clean (SIGTERM + DECRST) exits leak: readline inserts `35;5;3M35;18;14M...` at the returned prompt and Enter executes it (`bash: 35: command not found`, ...)
  - Added both acceptance regression tests as `it.fails` (green now, flip red when a fix lands)
  - Confirmed mechanism: sender is fire-and-forget; CLI writes every `input` frame to the PTY; bytes queue unread in the tty buffer and are re-read by the shell after the process boundary — Android-side stale-mouse suppression can only gate future gestures
  - Full gates green: root `pnpm typecheck` / `lint` / `build` / `test`, Android unit (81), browser suite (25/26; one failure is the pre-existing snapshot case documented in AGENTS.md)
- Not done:
  - No fix implemented; fix must cover packets already queued in the tty input buffer, not only future pointer events

## What to build

Prevent terminal mouse-report packets generated while a mouse-enabled TUI is stalled from becoming literal shell input when that TUI exits or is killed. The process-boundary handling must cover packets already queued before the Mobily shell prompt appears, not only pointer events generated afterward.

Normal mouse clicks, hover handling, and swipe-to-wheel behavior must continue working while a TUI legitimately owns mouse reporting.

## Acceptance criteria

- [ ] Pointer movement while a TUI is stalled cannot produce literal SGR mouse strings in the returning shell. _(fails today — reproduced on `test/issue-3-c`; regression pinned as `it.fails`)_
- [ ] Killing a stalled mouse-enabled TUI leaves a clean, empty shell prompt. _(fails today — reproduced; regression pinned as `it.fails`)_
- [ ] No queued mouse packet can execute or modify a shell command after the process boundary. _(fails today — leaked packets execute as shell commands in the repro)_
- [ ] Mouse clicks and swipe-generated wheel packets still reach an active mouse-enabled TUI. _(covered by the existing Playwright browser suite, green)_
- [ ] Future pointer events remain suppressed after the Mobily shell prompt clears mouse mode. _(covered by the existing Playwright browser suite, green)_
- [ ] A regression test queues mouse movement before the prompt/process exit and verifies that the shell receives no mouse-report input. _(added as `it.fails` in `cli/tests/queuedMouseReports.integration.test.ts`; remove `.fails` when fixed)_
- [ ] Clean and abrupt TUI exits are both covered. _(both reproduced: SIGTERM clean exit and SIGKILL abrupt exit leak identically)_

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

### 2026-07-31 — branch `test/issue-3-c` CLI wire-protocol reproduction

Cloud run reproduced the leak headlessly at the PTY boundary (see
`.scratch/android-terminal-rash-bugs/issue-3-cli-test-report-c.md`).

- A stalled mouse-enabled TUI (alt screen, DECSET 1003/1006, raw stdin, never
  reads) was driven through the real `Session` + WebSocket path; SGR motion
  packets sent as `input` frames queued unread in the tty buffer.
- After SIGKILL **and** after a clean SIGTERM exit (proper
  `\x1b[?1003l\x1b[?1006l\x1b[?1049l`), the returning bash adopted the queued
  packets as literal input — `35;5;3M35;18;14M...` at the prompt, matching the
  on-device capture — and executed them on Enter (`bash: 35: command not found`).
- Root cause confirmed: the WebView sends mouse packets fire-and-forget and the
  CLI writes every `input` frame straight to the PTY; existing stale-mouse
  suppression only gates future gestures, so a fix must also drain/cover packets
  already queued before the prompt appears.
- `cli/tests/queuedMouseReports.integration.test.ts` (fixture
  `cli/tests/fixtures/stalled-mouse-tui.mjs`) contains two bug-characterization
  tests (pass) and two acceptance regression tests (`it.fails` — remove the
  marker once fixed). No product source was changed on this branch.
