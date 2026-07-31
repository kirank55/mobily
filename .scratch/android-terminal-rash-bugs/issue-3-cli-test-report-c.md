# Issue 3 CLI test report (`test/issue-3-c`)

Ticket: `.scratch/android-terminal-rash-bugs/issues/03-prevent-queued-mouse-report-leaks.md`

Branch: `test/issue-3-c`

## Verdict

**Bug reproduced deterministically in the cloud.** SGR mouse-report packets sent
as ordinary `input` frames while a mouse-enabled TUI is stalled sit unread in the
PTY input queue and are adopted by the returning shell as literal input —
matching the ticket's on-device capture `35;5;3M35;18;14M...` exactly. Both
abrupt kills (SIGKILL) and clean exits (SIGTERM with a proper
`\x1b[?1003l\x1b[?1006l\x1b[?1049l`) leak identically, and the leaked text is
executed as shell commands after the process boundary.

No fix was attempted on this branch (test-only). Two `it.fails` regression tests
now pin the acceptance behavior and will fail loudly as soon as a fix lands.

## What ran

### New reproduction / regression suite

`cli/tests/queuedMouseReports.integration.test.ts` (with fixture
`cli/tests/fixtures/stalled-mouse-tui.mjs`) drives the real wire protocol: a
bare PTY bash (`PS1='[mobily] $ '`) behind `Session` + `startServer`, a plain
`ws` client standing in for the Android app, and a stalled TUI fixture
(alternate screen, DECSET 1003 + 1006, stdin raw, never reads).

Each scenario:

1. Waits for a live echo marker (the first prompt predates the WS attach).
2. Launches the fixture; parses its pid from the PTY output.
3. Sends four SGR motion packets (`\x1b[<35;5;3M` …) as two `input` frames.
4. Verifies nothing echoes while the TUI is stalled (bytes are queued, unread).
5. SIGKILL (abrupt) or SIGTERM (fixture emits DECRSTs and exits 0 — clean).
6. Waits for the returned prompt, then sends a plain Enter.

Results (both variants):

- **Queued while stalled:** no mouse bytes in output — they are held in the tty
  input queue (the ticket's "packets already queued before the prompt appears").
- **Post-boundary:** readline inserts `35;5;3M`, `35;18;14M`, `35;33;5M`,
  `35;46;16M` as literal text at the prompt (escape prefixes discarded, BELs
  rung) — the exact on-device observation.
- **After Enter:** `bash: 35: command not found`, `bash: 5: command not found`,
  `bash: 3M35: command not found`, … — queued mouse packets do modify/execute
  shell commands after the process boundary.

The four tests:

| Test                                                                                          | State      | Meaning                                |
| --------------------------------------------------------------------------------------------- | ---------- | -------------------------------------- |
| `abrupt kill: packets queued while the TUI is stalled leak into the returning shell`          | passes     | bug characterization (SIGKILL)         |
| `clean exit: packets queued while the TUI is stalled leak despite a proper DECRST`            | passes     | bug characterization (clean exit)      |
| `regression (pending fix): an abruptly killed stalled TUI leaves a clean, empty shell prompt` | `it.fails` | flips red when fixed — remove `.fails` |
| `regression (pending fix): a cleanly exited stalled TUI leaves a clean, empty shell prompt`   | `it.fails` | flips red when fixed — remove `.fails` |

Run:

```bash
pnpm --filter @mobily/shared build   # first run only
pnpm --filter mobily exec vitest run tests/queuedMouseReports.integration.test.ts
```

### Captured leak transcript (raw node-pty probe, SIGKILL variant)

```text
--- packets queued, output while stalled: ""
--- output after boundary (before Enter):
"Killed\r\n\u001b[?2004h[mobily] $ \u000735;5;3M\u000735;18;14M\u000735;33;5M\u000735;46;16M"
--- output after Enter:
"... bash: 35: command not found\r\nbash: 5: command not found\r\nbash: 3M35: command not found\r\n
 bash: 18: command not found\r\nbash: 14M35: command not found\r\nbash: 33: command not found\r\n
 bash: 5M35: command not found\r\nbash: 46: command not found\r\nbash: 16M: command not found\r\n..."
```

The SIGTERM variant is byte-for-byte equivalent apart from the leading
`\u001b[?1003l\u001b[?1006l\u001b[?1049l` cleanup written by the fixture.

### Why the leak happens (mechanism, confirmed by the repro)

- The Android WebView generates SGR packets (custom touch handlers + xterm
  `onData` motion) and forwards them fire-and-forget as `input` frames; there
  is no sender-side queue to retract (`android/src/terminal/terminalDocument.js`,
  `android/src/client/wsClient.ts`).
- The CLI writes every `input` frame straight into the PTY
  (`cli/src/session.ts` → `SessionBackend.write`); while the TUI is stalled and
  not reading, the kernel holds those bytes in the tty input queue.
- After the process boundary the shell re-reads the tty and consumes the queued
  bytes as literal input. A clean DECRST does not help: the bytes are already
  queued before the prompt appears.
- The existing Android-side "stale mouse" suppression
  (`applyTerminalMouseControls`, clears on DECRST/1049l/`[mobily] ` prompt) only
  gates **future** pointer gestures — it cannot touch bytes already in the tty
  buffer. This is the exact gap the ticket calls out.

### Existing coverage re-run (all on this branch)

| Suite                                                               | Result                                                                                                                                                                                        |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter mobily test` (real tmux first on PATH per AGENTS.md) | 24 files / 222 tests green                                                                                                                                                                    |
| `pnpm --filter mobily-android test`                                 | 21 files / 81 tests green                                                                                                                                                                     |
| `pnpm --filter mobily-android run test:browser`                     | 25 passed, 1 pre-existing failure (`renders a detailed OpenCode-like Session Snapshot in the production document` — documented in AGENTS.md, red on `main` and in CI's `android-browser` job) |
| Root gate `pnpm typecheck` / `lint` / `build` / `test`              | all green                                                                                                                                                                                     |

Browser cases that already cover ticket AC #4/#5 (and passed):
`does not write stale mouse packets into a shell prompt`,
`returns taps to keyboard focus after a mouse-enabled TUI exits`,
`does not emit stale mouse packets when connection scrollback restores a shell`,
`sends a vertical swipe to a mouse-enabled TUI when terminal history is at bottom`,
`scrolls a mouse-enabled alternate-screen TUI with a vertical swipe`.

## Acceptance criteria status

| Criterion                                                                                                                  | Result in this run                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Pointer movement while a TUI is stalled cannot produce literal SGR strings in the returning shell                          | **Bug reproduced** — it does today; regression test pinned (`it.fails`)                                 |
| Killing a stalled mouse-enabled TUI leaves a clean, empty shell prompt                                                     | **Bug reproduced** — prompt returns with `35;5;3M…` inserted; regression test pinned                    |
| No queued mouse packet can execute or modify a shell command after the process boundary                                    | **Bug reproduced** — leaked packets execute (`bash: 35: command not found`)                             |
| Mouse clicks and swipe wheel packets still reach an active mouse-enabled TUI                                               | Covered by existing browser suite (green)                                                               |
| Future pointer events remain suppressed after the Mobily shell prompt clears mouse mode                                    | Covered by existing browser suite (green)                                                               |
| Regression test queues mouse movement before the prompt/process exit and verifies the shell receives no mouse-report input | **Added** as `it.fails` (abrupt + clean variants) in `cli/tests/queuedMouseReports.integration.test.ts` |
| Clean and abrupt TUI exits are both covered                                                                                | **Yes** — SIGTERM (clean DECRST) and SIGKILL (abrupt), both leak                                        |

## Notes for the fix branch

- Any fix must cover packets **already queued** in the tty input buffer, not only
  future pointer events: sender-side (Android) suppression alone cannot retract
  bytes already written to the PTY master.
- Candidate directions (not evaluated here): CLI-side flush of the tty input
  queue when the output stream crosses the process boundary (mouse DECRST /
  `[mobily] ` prompt), or deferring mouse-report frames on the sender while the
  TUI is not draining input.
- When the fix lands, the two `it.fails` tests turn red (they expect failure);
  remove the `.fails` marker and keep them as the permanent regression tests.

## Artifacts

- `cli/tests/queuedMouseReports.integration.test.ts`
- `cli/tests/fixtures/stalled-mouse-tui.mjs`
