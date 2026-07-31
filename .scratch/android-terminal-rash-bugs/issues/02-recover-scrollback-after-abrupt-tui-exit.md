# Recover scrollback after abrupt alternate-screen TUI exit

Status: ready-for-agent

## What to build

Ensure the Android terminal returns to a usable normal-screen buffer when an alternate-screen TUI stops or dies without emitting its normal terminal cleanup sequence. When the Mobily shell prompt returns, subsequent shell output must accumulate history and vertical swipes must move through it.

The recovery must not damage correctly restored alternate-screen sessions or interfere with orderly TUI exits.

## Acceptance criteria

- [ ] Killing or interrupting an alternate-screen TUI without its cleanup sequence returns the terminal to a normal-screen shell state.
- [ ] Printing more lines than the visible grid after recovery produces non-zero xterm scrollback.
- [ ] A vertical history gesture changes the xterm viewport position.
- [ ] The Mobily header and terminal controls remain usable throughout recovery.
- [ ] An orderly alternate-screen exit continues to render correctly.
- [ ] Session Snapshot and transferred scrollback restoration continue to work for both normal and alternate screens.
- [ ] A regression test covers a Mobily shell prompt arriving while xterm is still in alternate-screen mode.

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
