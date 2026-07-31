# Prevent queued terminal mouse reports from leaking into the shell

Status: ready-for-agent

## Progress

- State: **fixed CLI-side; verified at wire/PTY level in cloud** (on-device verification pending on a capable host)
- Branch: `test/issue-3-c`
- Report: `.scratch/android-terminal-rash-bugs/issue-3-cli-test-report-c.md`
- Done:
  - Reproduced the leak deterministically over the real wire protocol (bare PTY bash + `Session` + `startServer` + `ws` client): both abrupt (SIGKILL) and clean (SIGTERM + DECRST) exits leaked `35;5;3M35;18;14M...` into the returned prompt, executed as commands on Enter
  - Fix: `cli/src/mouseReportingGuard.ts` — tracks mouse ownership on the output stream (DECSET 1000/1002/1003 arms; the `[mobily] ` prompt is the process boundary) and writes VINTR (`\x03`) at the boundary when mouse reports were forwarded, so the line discipline discards the queued input (SIGINT also aborts any readline line already polluted); post-boundary in-flight mouse packets are dropped for 1500 ms
  - Wired into `cli/src/session.ts` across all output and both input paths (WS `input` frames + embedded workstation)
  - Regression coverage: `cli/tests/mouseReportingGuard.test.ts` (12 unit tests) + rewritten `cli/tests/queuedMouseReports.integration.test.ts` (abrupt kill, clean exit, active-TUI delivery, keyboard-only no-interrupt) with fixtures `stalled-mouse-tui.mjs` / `reading-mouse-tui.mjs`
  - Full gates green: root `pnpm typecheck` / `lint` / `build` / `test`; CLI 25 files/234 tests; Android unit 81; browser suite 25/26 (one failure is the pre-existing snapshot case documented in AGENTS.md)
- Not done:
  - On-device confirmation against the ticket's `hover-string-repro.ps1` harness (needs real device + tunnel; bash shows a transient `^C` at the boundary by design when mouse input flowed)

## What to build

Prevent terminal mouse-report packets generated while a mouse-enabled TUI is stalled from becoming literal shell input when that TUI exits or is killed. The process-boundary handling must cover packets already queued before the Mobily shell prompt appears, not only pointer events generated afterward.

Normal mouse clicks, hover handling, and swipe-to-wheel behavior must continue working while a TUI legitimately owns mouse reporting.

## Acceptance criteria

- [x] Pointer movement while a TUI is stalled cannot produce literal SGR mouse strings in the returning shell. _(fixed: boundary flush discards queued input; stale post-boundary packets dropped)_
- [x] Killing a stalled mouse-enabled TUI leaves a clean, empty shell prompt. _(fixed + tested; bash shows a transient `^C` above the empty prompt)_
- [x] No queued mouse packet can execute or modify a shell command after the process boundary. _(fixed + tested: no `command not found` after Enter)_
- [x] Mouse clicks and swipe-generated wheel packets still reach an active mouse-enabled TUI. _(wire-level reading-TUI test + existing Playwright browser suite)_
- [x] Future pointer events remain suppressed after the Mobily shell prompt clears mouse mode. _(existing Android suppression, browser suite green; CLI also drops in-flight packets for 1500 ms)_
- [x] A regression test queues mouse movement before the prompt/process exit and verifies that the shell receives no mouse-report input. _(`cli/tests/queuedMouseReports.integration.test.ts`, abrupt + clean variants)_
- [x] Clean and abrupt TUI exits are both covered. _(SIGTERM clean exit and SIGKILL abrupt exit, both tested)_

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

### 2026-07-31 — fix: CLI-side boundary flush (`MouseReportingGuard`)

- The Session now tracks mouse ownership on the output stream and flushes
  queued input at the `[mobily] ` prompt boundary by writing VINTR when mouse
  reports were forwarded since the TUI took ownership. DECRST/1049l do not
  disarm (queued packets predate them; only the prompt proves the shell is
  reading). In-flight mouse packets are dropped for 1500 ms post-boundary.
- All seven acceptance criteria pass in the new unit + wire-level integration
  tests; keyboard-only TUI sessions never trigger the flush (no spurious
  interrupts). tmux with default `mouse off` neither re-emits DECSET nor lets
  clients generate mouse packets, so the guard's arming condition matches the
  leak's precondition on every backend.
- Trade-off: when mouse input flowed, a TUI exit emits one VINTR — bash shows
  `^C` above a fresh, empty prompt (zsh/fish show nothing). Chosen over letting
  `35;5;3M…` execute as a command.
- Left for a capable host: on-device confirmation with the aggressive hover
  harness.
