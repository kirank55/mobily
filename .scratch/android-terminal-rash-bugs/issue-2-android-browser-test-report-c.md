# Issue 2 Android browser / xterm test report (`test/issue-2-c`)

Ticket: `.scratch/android-terminal-rash-bugs/issues/02-recover-scrollback-after-abrupt-tui-exit.md`

Branch: `test/issue-2-c`

## Verdict

**Bug reproduced deterministically in the cloud.** Entering the alternate
screen (`\x1b[?1049h`) and returning to the Mobily shell prompt without
`\x1b[?1049l` leaves xterm on the alternate buffer. Printing 200 lines then
produces `baseY === 0` and a vertical history swipe does not move
`viewportY` — matching the on-device rash-test evidence
(`VERDICT=RED xterm retained no scrollback after 200 lines of output`).

An orderly exit (`\x1b[?1049l` before the prompt) still accumulates normal-
screen scrollback and accepts history swipes. No product fix was attempted on
this branch (test-only). Pending-fix regressions are pinned with
`test.fail()` / `it.fails` and will fail loudly once recovery lands.

## What ran

### Headless xterm characterization (pre-test)

```text
after enter alt: alternate baseY 0
after abrupt prompt: alternate baseY 0
after 200 lines: alternate baseY 0 viewportY 0
orderly after 200: normal baseY 178
```

### New reproduction / regression suite

- `android/tests/browser/abruptAltScreenScrollback.pw.mjs` — production WebView
  document via Playwright:
  - characterization: abrupt exit → no scrollback after 200 lines (DOM
    `scrollHeight === clientHeight`, xterm `baseY === 0`)
  - characterization: vertical history gesture is a no-op after abrupt exit
  - green path: orderly `1049l` exit still scrolls and accepts swipes; key row
    remains visible
  - `test.fail` regression: Mobily prompt while still on alternate must recover
    scrollback + history swipe
- `android/tests/terminalDocument.test.ts` — matching headless xterm
  characterization + `it.fails` acceptance pin

### Commands and results

| Command | Result |
| --- | --- |
| `pnpm --filter @mobily/shared build` | required once (dist missing in fresh env) |
| `pnpm --filter mobily-android exec vitest run tests/terminalDocument.test.ts` | 16 passed (includes 2 characterizations + 1 `it.fails`) |
| `pnpm --filter mobily-android test` | 21 files / 84 tests green |
| `pnpm --filter mobily-android exec playwright test abruptAltScreenScrollback` | 4 passed (3 characterizations + 1 expected-fail regression) |
| `pnpm --filter mobily-android run test:browser` | 29 passed, 1 pre-existing failure (`renders a detailed OpenCode-like Session Snapshot in the production document` — documented in AGENTS.md, red on `main`) |

## Acceptance criteria status

| Criterion | Result in this run |
| --- | --- |
| Killing/interrupting an alt-screen TUI without cleanup returns normal-screen shell state | **Bug reproduced** — stays on `alternate`; regression pinned |
| Printing more lines than the grid after recovery produces non-zero xterm scrollback | **Bug reproduced** — `baseY === 0` after 200 lines |
| Vertical history gesture changes xterm viewport position | **Bug reproduced** — swipe is a no-op; works after orderly exit |
| Mobily header / terminal controls remain usable throughout recovery | Key row stays `display:flex` in abrupt + orderly cases |
| Orderly alternate-screen exit continues to render correctly | **Green** — characterization + swipe pass |
| Session Snapshot / transferred scrollback restoration for normal and alternate | Covered by existing browser suite (not re-broken here) |
| Regression test: Mobily prompt while xterm still in alternate-screen | **Added** as `test.fail` / `it.fails` |

## Notes for the fix branch

- `applyTerminalMouseControls` already treats `[mobily] ` as a process boundary
  for **mouse modes**, but `prepareOutput` still writes the raw stream into
  xterm. Alternate-screen recovery needs an injected `\x1b[?1049l` (or
  equivalent) at that same boundary when the active buffer is still alternate.
- Do not break orderly exits that already emit `1049l`, or snapshot /
  scrollback rebuild paths that intentionally enter alternate.
- When the fix lands, remove `test.fail()` in the Playwright case and `.fails`
  in the vitest case; keep them as permanent regressions.

## Artifacts

- `android/tests/browser/abruptAltScreenScrollback.pw.mjs`
- `android/tests/terminalDocument.test.ts` (issue 02 cases)
