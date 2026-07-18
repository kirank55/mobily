# Preserve full-screen Session state across tmux and bare PTY

Status: ready-for-agent

## What to build

Extend Session Snapshots from the initial bare-PTY tracer bullet to identical tmux behavior and full-screen terminal applications. Both Session backends must produce the same externally observable snapshot semantics for colors, character attributes, Unicode width, cursor placement, alternate-screen content, clears, and redraws.

Use representative full-screen ANSI output, including an OpenCode-like layout, to ensure Android receives the detail visible on the Station.

## Acceptance criteria

- [ ] tmux-backed and bare-PTY Sessions expose the same Session Snapshot contract.
- [ ] A client attaching while a full-screen application is idle receives the current alternate-screen contents without requiring new output.
- [ ] Colors, attributes, Unicode, cursor state, clears, cursor movement, and redraws survive snapshot serialization and Android rendering.
- [ ] Existing deliberate mouse-mode handling does not strip unrelated display controls.
- [ ] Backend-specific replay history is not mistaken for the atomic visible Session Snapshot.
- [ ] Real tmux and bare-PTY integration tests run the same full-screen fixture and assert equivalent visible state.
- [ ] The production Android terminal browser seam verifies a detailed OpenCode-like layout rather than only checking for nonempty text.
- [ ] Relevant terminal-session architecture documentation describes backend-independent snapshot semantics.

## Blocked by

- [Issue 01](./01-show-idle-bare-session-on-android.md)
