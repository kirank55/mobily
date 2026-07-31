# Recover scrollback after abrupt alternate-screen TUI exit

Status: ready-for-agent

## Progress

- State: **fixed on `test/issue-2-c`**
- Branch: `test/issue-2-c`
- Report: `.scratch/android-terminal-rash-bugs/issue-2-android-browser-test-report-c.md`
- Done:
  - Reproduced then fixed: `applyTerminalMouseControls` tracks DECSET/DECRST 47/1047/1049 and injects `\x1b[?1049l` when `[mobily] ` arrives while still on the alternate screen (including chunk-straddling prompts)
  - Regenerated `xtermAssets.generated.ts`
  - Permanent regressions in `android/tests/browser/abruptAltScreenScrollback.pw.mjs` and `android/tests/terminalDocument.test.ts`
  - Android unit 86 green; issue 2 Playwright 3/3; full browser 28/29 with only the pre-existing OpenCode snapshot failure

## What to build

Ensure the Android terminal returns to a usable normal-screen buffer when an alternate-screen TUI stops or dies without emitting its normal terminal cleanup sequence. When the Mobily shell prompt returns, subsequent shell output must accumulate history and vertical swipes must move through it.

The recovery must not damage correctly restored alternate-screen sessions or interfere with orderly TUI exits.

## Acceptance criteria

- [x] Killing or interrupting an alternate-screen TUI without its cleanup sequence returns the terminal to a normal-screen shell state.
- [x] Printing more lines than the visible grid after recovery produces non-zero xterm scrollback.
- [x] A vertical history gesture changes the xterm viewport position.
- [x] The Mobily header and terminal controls remain usable throughout recovery.
- [x] An orderly alternate-screen exit continues to render correctly.
- [x] Session Snapshot and transferred scrollback restoration continue to work for both normal and alternate screens. _(existing browser suite still green aside from the pre-existing OpenCode snapshot case)_
- [x] A regression test covers a Mobily shell prompt arriving while xterm is still in alternate-screen mode.

## Blocked by

None - can start immediately.

## Comments

Deterministic reproduction:

`/home/kiran/code-wsl/playground/.test-evidence/aggressive-rash-test/scroll-repro.ps1`

Observed production WebView state after 200 lines:

```text
BEFORE_SCROLL_TOP=0
BEFORE_SCROLL_HEIGHT=640
BEFORE_CLIENT_HEIGHT=640
AFTER_SCROLL_TOP=0
AFTER_SCROLL_HEIGHT=640
AFTER_CLIENT_HEIGHT=640
VERDICT=RED xterm retained no scrollback after 200 lines of output
```

Supporting report:

`/home/kiran/code-wsl/playground/.test-evidence/aggressive-rash-test/report.md`

### 2026-07-31 — branch `test/issue-2-c` Android browser / xterm reproduction

Cloud run reproduced the scrollback loss headlessly (see
`.scratch/android-terminal-rash-bugs/issue-2-android-browser-test-report-c.md`).

- Alternate screen entered via `\x1b[?1049h`; abrupt return wrote only
  `\r\n[mobily] shell$ ` (no DECRST 1049). xterm remained on `alternate`.
- After 200 shell lines: `baseY === 0`, `scrollHeight === clientHeight`, vertical
  history swipe left `viewportY` unchanged — same RED verdict as device.
- Orderly `\x1b[?1049l` path still yields `normal` with non-zero `baseY` and a
  working history swipe.
- Root cause confirmed at the client: `applyTerminalMouseControls` clears mouse
  modes on the Mobily prompt boundary but did not leave the alternate screen;
  `prepareOutput` wrote the raw stream into xterm unchanged.

### 2026-07-31 — fix on `test/issue-2-c`

`applyTerminalMouseControls` now tracks alternate-screen DEC modes and injects
`\x1b[?1049l` immediately before a Mobily prompt that arrives while still on the
alternate buffer. Orderly exits that already emit `1049l` are unchanged.
Regressions cover abrupt recovery, history swipe, orderly exit, and
chunk-straddling prompts.
