# Known bugs

Defects found in a deep review of Station size ownership, mobile fit-to-viewport, snapshots/reconnect, and CLI auth attach. Ordered by severity.

## [P1] Stuck “Loading Session…” after WebView remount while still connected

**Where:** `android/src/app/terminal.tsx` (~line 160)

`handleTerminalReady` always posts `loading` (unless reconnecting) and re-applies the pending snapshot, but it never clears `snapshotApplied`. After first paint (`connected` + `snapshotApplied === true`), a WebView remount (renderer Retry / `onLoadStart` reload → new ready) can finish `snapshot-applied` with `setSnapshotApplied(true)` as a no-op, so the live effect never re-runs and the in-document overlay stays opaque.

## [P1] First phone auth mutates the Session after the snapshot is sent

**Where:** `cli/src/session.ts` (~line 392)

`attachAuthenticated` sends the snapshot, adds the subscriber, then fires `onAuthenticatedClient`. Tmux workstation attach then runs `showPairingPanel` / `clearShellPane` (`clear` + Enter). That live output rewrites the screen Android just painted, against ADR 0004’s snapshot-then-continue contract.

## [P1] `resize` ignores the in-flight snapshot swap

**Where:** `android/src/terminal/terminalDocument.js` (~line 600)

Writes are queued while `snapshotInFlight` is set; `resize` still mutates the old `term`. When the hidden replacement swaps in, the resize is dropped and Fit scales the wrong grid (reconnect / Station resize during scrollback rebuild).

## [P1] Fit scale floor of `0.2` can still cut off large Station grids

**Where:** `android/src/terminal/terminalDocument.js` (~line 5)

`fitTerminalScale` clamps through `clampTerminalScale` (min `0.2`). A wide desktop grid on a phone can need &lt; 0.2; Fit then cannot show the full frame without pan. Playwright only checks ~120×40, which stays above the floor.

## [P1] Viewport `ResizeObserver` always re-fits and wipes zoom/pan

**Where:** `android/src/terminal/terminalDocument.js` (~line 621)

With `ownsSize === false` (current Android mode), every viewport resize calls `fitView()`, which resets scale and `scrollLeft`/`scrollTop`. Soft keyboard / orientation / chrome changes discard user pinch zoom even though Fit is meant to be explicit and readability is left to zoom.

## [P2] Scrollback rebuild re-fits after the UI is already interactive

**Where:** `android/src/terminal/terminalDocument.js` (~line 516)

`applyScrollback` always ends in `fitView()`. Snapshot ack / live can happen before history arrives, so a user who zooms in that window loses the transform when scrollback swaps.

## [P2] Fitted CSS scale leaves an unscaled layout box (ghost scroll)

**Where:** `android/src/terminal/terminalDocument.js` (~line 524)

`applyScale` sizes `#tc` to unscaled pixels and uses `transform: scale(...)`. Absolute surfaces still expand `#viewport` scroll overflow, so Fit can leave pannable empty space. Tests assert `width * scale` vs viewport, not `scrollWidth`/`scrollHeight`.

## [P2] Exit/dispose miss clients still in the capture window

**Where:** `cli/src/session.ts` (~line 713)

Between auth handler registration and `subscribers.add`, the socket is only in `pendingLatencyTags`. Exit closes `subscribers` only; a late `capture` can still send a snapshot / add the socket after `exited`, or leave a hung post-`auth-ok` client on dispose.

## [P2] Size claims accepted before snapshot attach completes

**Where:** `cli/src/session.ts` (~line 378)

Message handling (including claims) is registered before `screen.capture`. Production Android does not claim, but any claimant in that window can steal ownership before the first screen is delivered.

## [P3] Dead Android size-claim controller still encodes the old policy

**Where:** `android/src/terminal/sizeOwnership.ts` (~line 61)

`TerminalSizeOwnershipController` still claims when connected+visible+active and is only covered by unit tests. Live `StationConnection` correctly does not wire it; the leftover API makes accidental reintroduction easy.

## [P3] Playwright can false-green stale shipped helpers

**Where:** `android/package.json` (~line 57)

`pnpm test` does not run `generate:terminal-assets`. Browser tests build helpers from source `terminalDocument.js`; the app embeds `xtermAssets.generated.ts`. Helper changes can pass CI while the shipped WebView runs old code.

## Coverage gaps

- No route-level `terminal.tsx` remount/reconnect tests.
- No test that workstation attach must not mutate the Session after snapshot send.
