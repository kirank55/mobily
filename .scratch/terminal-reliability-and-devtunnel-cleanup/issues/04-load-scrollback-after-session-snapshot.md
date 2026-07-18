# Load bounded scrollback after the visible Session Snapshot

Status: resolved

## What to build

Deliver recent bounded Session history to Android only after the visible Session Snapshot has painted. Scrollback must be a distinct ordered payload rather than raw replay masquerading as current screen state. A large history must not delay first paint or overwrite newer live output.

## Acceptance criteria

- [ ] The visible Session Snapshot is applied before any scrollback transfer begins.
- [ ] Android reveals the current screen without waiting for the complete history payload.
- [ ] Scrollback is bounded by an explicit resource limit and cannot grow without limit on either peer.
- [ ] Scrollback ordering preserves newer live output and does not move the user away from the current screen unexpectedly.
- [ ] Duplicate, delayed, or interrupted history payloads do not duplicate terminal content.
- [ ] tmux and bare-PTY Sessions provide equivalent bounded-history behavior.
- [ ] Protocol validation rejects malformed, oversized, or out-of-order history payloads.
- [ ] Deterministic integration and browser tests prove that a maximum-sized history does not block nonblank first paint.

## Blocked by

- [Issue 01](./01-show-idle-bare-session-on-android.md)
