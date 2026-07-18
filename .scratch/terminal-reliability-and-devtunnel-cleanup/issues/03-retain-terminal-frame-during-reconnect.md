# Retain and atomically replace the terminal frame during reconnect

Status: ready-for-agent

## What to build

Keep Android's last rendered terminal frame visible during transient connection loss, mark it as reconnecting, and replace it atomically after authentication yields a fresh Session Snapshot. Reconnect must not clear the terminal, mix old and new frames, duplicate output, or allow delayed traffic from an earlier socket to corrupt the current view.

## Acceptance criteria

- [ ] A transient disconnect leaves the last rendered frame visible.
- [ ] Android displays a reconnecting indicator that distinguishes retained state from live state.
- [ ] A newly authenticated socket replaces retained state only after its complete Session Snapshot is available.
- [ ] Snapshot replacement is atomic from the user's perspective; old and new cells are never mixed.
- [ ] Output buffered behind the replacement snapshot is delivered exactly once and in order.
- [ ] Frames from a superseded socket cannot mutate the current terminal.
- [ ] Permanent failure replaces the reconnecting state with the existing actionable failure UX.
- [ ] Headless production-terminal and WebSocket tests reproduce clearing/duplication failures and verify the corrected behavior.

## Blocked by

- [Issue 02](./02-preserve-full-screen-state-across-backends.md)
