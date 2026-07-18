# Preserve full-screen Session state across tmux and bare PTY

Status: resolved

## What to build

Extend Session Snapshots from the initial bare-PTY tracer bullet to identical tmux behavior and full-screen terminal applications. Both Session backends must produce the same externally observable snapshot semantics for colors, character attributes, Unicode width, cursor placement, alternate-screen content, clears, and redraws.

Use representative full-screen ANSI output, including an OpenCode-like layout, to ensure Android receives the detail visible on the Station.

## Acceptance criteria

- [x] tmux-backed and bare-PTY Sessions expose the same Session Snapshot contract.
- [x] A client attaching while a full-screen application is idle receives the current alternate-screen contents without requiring new output.
- [x] Colors, attributes, Unicode, cursor state, clears, cursor movement, and redraws survive snapshot serialization and Android rendering.
- [x] Existing deliberate mouse-mode handling does not strip unrelated display controls.
- [x] Backend-specific replay history is not mistaken for the atomic visible Session Snapshot.
- [x] Real tmux and bare-PTY integration tests run the same full-screen fixture and assert equivalent visible state.
- [x] The production Android terminal browser seam verifies a detailed OpenCode-like layout rather than only checking for nonempty text.
- [x] Relevant terminal-session architecture documentation describes backend-independent snapshot semantics.

## Blocked by

- [Issue 01](./01-show-idle-bare-session-on-android.md)

## Answer

Implemented backend-independent full-screen Session Snapshots for bare PTY and tmux Sessions.
The Session now captures a backend's visible screen separately from replay history, buffers
output produced across that initialization boundary, and preserves attributed alternate-screen
content, Unicode width, cursor state, clears, movement, and redraws. Real-backend tests compare
the complete snapshots from one shared full-screen fixture, and the production Android browser
harness verifies a detailed OpenCode-like render plus selective mouse-control filtering.
