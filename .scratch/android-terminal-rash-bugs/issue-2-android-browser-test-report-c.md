# Issue 2 Android browser / xterm test report (`test/issue-2-c`)

Ticket: `.scratch/android-terminal-rash-bugs/issues/02-recover-scrollback-after-abrupt-tui-exit.md`

Branch: `test/issue-2-c`

## Verdict

**Fixed on `test/issue-2-c`.** Entering the alternate screen (`\x1b[?1049h`) and
returning to the Mobily shell prompt without `\x1b[?1049l` previously left
xterm on the alternate buffer (`baseY === 0`, history swipe no-op). The client
now injects `\x1b[?1049l` at that process boundary so shell output accumulates
normal-buffer scrollback again. Orderly exits remain green.

## What ran

### Fix

`applyTerminalMouseControls` in `android/src/terminal/terminalDocument.js`:

- Tracks DECSET/DECRST 47 / 1047 / 1049 via `state.alternateScreen`
- On `[mobily] ` while `alternateScreen` is set, injects `\x1b[?1049l` before
  the prompt (and replays a chunk-straddling prompt prefix onto the normal
  buffer)
- Regenerated `android/src/terminal/xtermAssets.generated.ts`

### Commands and results

| Command | Result |
| --- | --- |
| `pnpm --filter mobily-android generate:terminal-assets` | helpers regenerated |
| `pnpm --filter mobily-android exec vitest run tests/terminalDocument.test.ts` | 18 passed |
| `pnpm --filter mobily-android test` | 21 files / 86 tests green |
| `pnpm --filter mobily-android typecheck` / `lint` | green |
| `pnpm --filter mobily-android exec playwright test abruptAltScreenScrollback` | 3 passed |
| `pnpm --filter mobily-android run test:browser` | 28 passed, 1 pre-existing failure (OpenCode snapshot case in AGENTS.md) |

## Acceptance criteria status

| Criterion | Result in this run |
| --- | --- |
| Killing/interrupting an alt-screen TUI without cleanup returns normal-screen shell state | **Fixed** — prompt leaves alternate buffer |
| Printing more lines than the grid after recovery produces non-zero xterm scrollback | **Fixed** — `baseY > 0` after 200 lines |
| Vertical history gesture changes xterm viewport position | **Fixed** — swipe moves `viewportY` |
| Mobily header / terminal controls remain usable throughout recovery | Key row stays `display:flex` |
| Orderly alternate-screen exit continues to render correctly | **Green** |
| Session Snapshot / transferred scrollback restoration for normal and alternate | Existing browser suite unchanged aside from pre-existing OpenCode failure |
| Regression test: Mobily prompt while xterm still in alternate-screen | Permanent cases in Playwright + vitest |

## Artifacts

- `android/src/terminal/terminalDocument.js` / `.d.ts`
- `android/src/terminal/xtermAssets.generated.ts`
- `android/tests/browser/abruptAltScreenScrollback.pw.mjs`
- `android/tests/terminalDocument.test.ts` (issue 02 cases)
