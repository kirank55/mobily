# Issue 3 test + fix report (`test/issue-3-c`)

Ticket: `.scratch/android-terminal-rash-bugs/issues/03-prevent-queued-mouse-report-leaks.md`

Branch: `test/issue-3-c`

## Verdict

**Bug reproduced deterministically in the cloud, then fixed CLI-side and verified.**
SGR mouse-report packets sent as ordinary `input` frames while a mouse-enabled
TUI is stalled sat unread in the PTY input queue and were adopted by the
returning shell as literal input (`35;5;3M35;18;14M...` at the prompt, executed
as commands) — for both abrupt kills (SIGKILL) and clean exits (SIGTERM with a
proper `\x1b[?1003l\x1b[?1006l\x1b[?1049l`).

The fix adds a `MouseReportingGuard` to the Station `Session`: it tracks mouse
ownership on the output stream and, at the `[mobily] ` prompt boundary with
mouse reports potentially queued, writes VINTR (`\x03`) so the line discipline
discards the queued input — and aborts any readline line the packets already
polluted. Post-boundary in-flight mouse packets are dropped for a 1500 ms
suppression window. Every arrival ordering ends at a clean, empty prompt, and
no queued packet can execute as a shell command.

## Root cause (confirmed by reproduction)

- The Android WebView generates SGR packets and forwards them fire-and-forget
  as `input` frames; there is no sender-side queue to retract
  (`android/src/terminal/terminalDocument.js`, `android/src/client/wsClient.ts`).
- The CLI wrote every `input` frame straight into the PTY
  (`cli/src/session.ts` → `SessionBackend.write`); while the TUI was stalled
  and not reading, the kernel held those bytes in the tty input queue.
- After the process boundary the shell re-read the tty and consumed the queued
  bytes as literal input. A clean DECRST did not help: the bytes were already
  queued before the prompt appeared. Sender-side suppression (Android's
  `applyTerminalMouseControls`) can only gate **future** gestures.

## Fix

### `cli/src/mouseReportingGuard.ts` (new)

- **Arming** — DECSET 1000/1002/1003 in the output stream means a
  mouse-enabled TUI owns the terminal (same convention as Android's tracker).
  DECRST/1049l deliberately do **not** disarm: queued packets predate them, and
  only the prompt proves the shell — not a still-running TUI — is reading.
- **Dirty tracking** — input frames consisting solely of mouse reports (SGR
  1006 / X10 / urxvt 1015 shapes) forwarded while armed.
- **Boundary flush** — the `[mobily] ` prompt prefix (installed by the tmux
  backend, already the Android process boundary) while armed && dirty writes
  `\x03` (VINTR) to the PTY: the line discipline discards pending input and
  SIGINT aborts the idle prompt's current line. Verified against bash (readline
  shells briefly echo the garbage before it is discarded — unavoidable, the
  echo is generated before the boundary is observable; the final line is always
  discarded). dash restores termios with input flushed and never leaked.
- **Suppression window** — pure mouse-report frames are dropped for 1500 ms
  after the flush (stale in-flight packets on high-latency links). Outside the
  window, unarmed mouse frames still forward (e.g. mid-TUI reattach), and
  non-mouse input is never touched.

### `cli/src/session.ts`

The guard sees all backend output (initial visible capture + live) and every
input path (WebSocket `input` frames and the embedded workstation terminal) —
the only two writers into the backend. No product behavior changes unless a
mouse TUI was active: keyboard-only sessions never fire the flush.

### Backend coverage

| Backend                          | Coverage                                                                                                                                                                                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| bare                             | Full: DECSET and `[mobily] ` both appear in the output stream.                                                                                                                                                                                             |
| tmux (default `mouse off`)       | Consistent by construction: tmux does not re-emit DECSET outward, so clients never generate mouse packets either (Android's tracker never arms) — probed: SGR input forwards to panes, outer output carries no DECSET. No leak vector, no behavior change. |
| tmux (`mouse on` in user config) | tmux re-emits DECSET outward → guard arms; `\x03` reaches the pane as an ordinary key and flushes the inner tty.                                                                                                                                           |

### Trade-off accepted

When mouse input flowed during a TUI session, exiting that TUI now emits one
VINTR at the returned prompt — bash shows a `^C` above a fresh, empty prompt
(zsh/fish show nothing). That is the standard Unix "input discarded"
affordance and strictly better than executing `35;5;3M…` as a command.
Keyboard-only TUI sessions are untouched (regression test included).

## Tests

### New / rewritten

| Test                                         | Asserts                                                                                                                                                                                 |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cli/tests/mouseReportingGuard.test.ts` (12) | arming per DECSET param, no flush unarmed / keyboard-only, flush once per boundary, DECRST+1049 still flush, chunk stitching, re-arm, suppression-window drop/forward, X10+urxvt shapes |
| `…integration.test.ts` › abrupt kill         | packets queue silently while stalled; flush fires (`^C`); nothing after the interrupt contains mouse text (incl. a post-flush stale packet); no `command not found`                     |
| `…integration.test.ts` › clean exit          | same, with a proper DECRST + alt-screen exit                                                                                                                                            |
| `…integration.test.ts` › active TUI          | click + wheel + motion + plain keys all reach a reading TUI (`TUI_GOT`) — AC #4 at the wire level                                                                                       |
| `…integration.test.ts` › keyboard-only TUI   | no `^C`, exactly one prompt, shell responsive afterwards                                                                                                                                |
| `cli/tests/fixtures/reading-mouse-tui.mjs`   | responsive mouse TUI fixture                                                                                                                                                            |

Run:

```bash
pnpm --filter @mobily/shared build   # first run only
pnpm --filter mobily exec vitest run tests/mouseReportingGuard.test.ts tests/queuedMouseReports.integration.test.ts
```

### Full gates (this branch)

| Suite                                                               | Result                                                                                                         |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Root `pnpm typecheck` / `lint` / `build` / `test`                   | all green (turbo 5/5)                                                                                          |
| `pnpm --filter mobily test` (real tmux first on PATH per AGENTS.md) | 25 files / 234 tests green; new integration suite stable 5/5 repeat runs                                       |
| `pnpm --filter mobily-android test`                                 | 21 files / 81 tests green                                                                                      |
| `pnpm --filter mobily-android run test:browser`                     | 25/26; the one failure is the pre-existing snapshot cursor case documented in AGENTS.md (red on `main` and CI) |

## Pre-fix evidence (first commit on this branch)

Raw node-pty probe, SIGKILL variant (SIGTERM identical apart from the DECRST
prefix):

```text
--- packets queued, output while stalled: ""
--- output after boundary (before Enter):
"Killed\r\n\u001b[?2004h[mobily] $ \u000735;5;3M\u000735;18;14M\u000735;33;5M\u000735;46;16M"
--- output after Enter:
"... bash: 35: command not found\r\nbash: 5: command not found\r\nbash: 3M35: command not found\r\n
 ... bash: 16M: command not found\r\n..."
```

Post-fix, the same scenario ends at a clean prompt with no execution.

## Acceptance criteria status

| Criterion                                                                                                                  | Result                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Pointer movement while a TUI is stalled cannot produce literal SGR mouse strings in the returning shell                    | **Fixed + tested** (queued input discarded at the boundary; stale post-boundary packets dropped)                        |
| Killing a stalled mouse-enabled TUI leaves a clean, empty shell prompt                                                     | **Fixed + tested** (final prompt clean; bash shows a transient `^C`)                                                    |
| No queued mouse packet can execute or modify a shell command after the process boundary                                    | **Fixed + tested** (no `command not found` after Enter)                                                                 |
| Mouse clicks and swipe-generated wheel packets still reach an active mouse-enabled TUI                                     | **Tested** (wire-level reading-TUI test + existing browser suite)                                                       |
| Future pointer events remain suppressed after the Mobily shell prompt clears mouse mode                                    | Covered by the existing Android suppression (browser suite green); CLI additionally drops in-flight packets for 1500 ms |
| Regression test queues mouse movement before the prompt/process exit and verifies the shell receives no mouse-report input | **Yes** — abrupt + clean variants in `cli/tests/queuedMouseReports.integration.test.ts`                                 |
| Clean and abrupt TUI exits are both covered                                                                                | **Yes** — SIGTERM (clean DECRST) and SIGKILL (abrupt)                                                                   |

## Remaining verification for a capable host

Cloud coverage is wire/PTY-level. On the WSL/device setup from
`docs/development.md`, rerun the ticket's `hover-string-repro.ps1` aggressive
hover test against a Xiaomi-class device and confirm the returning shell shows
no `35;…M` strings (a single `^C` may appear instead).
