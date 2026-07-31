# Recover scrollback after abrupt alternate-screen TUI exit

Status: ready-for-agent

## Progress

- State: **bug reproduced in cloud; fix pending** (test-only branch, no source fix)
- Branch: `test/issue-2-c`
- Report: `.scratch/android-terminal-rash-bugs/issue-2-android-browser-test-report-c.md`
- Done:
  - Reproduced on the production WebView document (Playwright) and headless xterm: after `\x1b[?1049h` without `\x1b[?1049l`, `[mobily] ` leaves `buffer.active.type === 'alternate'` and 200 lines keep `baseY === 0` / no history swipe — matching the on-device `VERDICT=RED` evidence
  - Confirmed orderly `\x1b[?1049l` exit still accumulates scrollback and accepts vertical history gestures; key row stays visible
  - Added characterization + pending-fix regression tests (`test.fail` / `it.fails`) in `android/tests/browser/abruptAltScreenScrollback.pw.mjs` and `android/tests/terminalDocument.test.ts`
  - Android unit suite green (84); browser suite 29/30 with only the pre-existing OpenCode snapshot failure
- Not done:
  - No fix implemented; product still only clears mouse modes on `[mobily] `, not alternate screen

## What to build

Ensure the Android terminal returns to a usable normal-screen buffer when an alternate-screen TUI stops or dies without emitting its normal terminal cleanup sequence. When the Mobily shell prompt returns, subsequent shell output must accumulate history and vertical swipes must move through it.

The recovery must not damage correctly restored alternate-screen sessions or interfere with orderly TUI exits.

## Acceptance criteria

- [ ] Killing or interrupting an alternate-screen TUI without its cleanup sequence returns the terminal to a normal-screen shell state. _(fails today — reproduced on `test/issue-2-c`; regression pinned)_
- [ ] Printing more lines than the visible grid after recovery produces non-zero xterm scrollback. _(fails today — `baseY === 0` after 200 lines)_
- [ ] A vertical history gesture changes the xterm viewport position. _(fails today after abrupt exit; works after orderly exit)_
- [ ] The Mobily header and terminal controls remain usable throughout recovery. _(key row stays visible in repro)_
- [ ] An orderly alternate-screen exit continues to render correctly. _(covered green in new characterization)_
- [ ] Session Snapshot and transferred scrollback restoration continue to work for both normal and alternate screens. _(existing browser suite)_
- [ ] A regression test covers a Mobily shell prompt arriving while xterm is still in alternate-screen mode. _(added as `test.fail` / `it.fails`; remove markers when fixed)_

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
  modes on the Mobily prompt boundary but does not leave the alternate screen;
  `prepareOutput` writes the raw stream into xterm unchanged.
- No product source was changed on this branch.
