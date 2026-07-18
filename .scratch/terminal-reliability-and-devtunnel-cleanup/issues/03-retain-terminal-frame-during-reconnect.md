# Retain and atomically replace the terminal frame during reconnect

Status: resolved

## What to build

Keep Android's last rendered terminal frame visible during transient connection loss, mark it as reconnecting, and replace it atomically after authentication yields a fresh Session Snapshot. Reconnect must not clear the terminal, mix old and new frames, duplicate output, or allow delayed traffic from an earlier socket to corrupt the current view.

## Acceptance criteria

- [x] A transient disconnect leaves the last rendered frame visible.
- [x] Android displays a reconnecting indicator that distinguishes retained state from live state.
- [x] A newly authenticated socket replaces retained state only after its complete Session Snapshot is available.
- [x] Snapshot replacement is atomic from the user's perspective; old and new cells are never mixed.
- [x] Output buffered behind the replacement snapshot is delivered exactly once and in order.
- [x] Frames from a superseded socket cannot mutate the current terminal.
- [x] Permanent failure replaces the reconnecting state with the existing actionable failure UX.
- [x] Headless production-terminal and WebSocket tests reproduce clearing/duplication failures and verify the corrected behavior.

## Blocked by

- [Issue 02](./02-preserve-full-screen-state-across-backends.md)

## Answer

Android now keeps the active xterm frame mounted under a lightweight reconnecting
status, stages each replacement Session Snapshot in a hidden production xterm, and
swaps the completed terminal into view atomically before flushing ordered live output.
Handshake resize metadata no longer mutates the retained frame, socket generations
reject delayed WebSocket traffic, and a reconnect transition invalidates snapshots
that are still parsing from a superseded socket. Permanent failures continue to use
the existing actionable failure screen.

Production-document browser tests cover retained-frame visibility, atomic replacement,
queued output delivery, and the disconnect-during-snapshot race. The real
Session/WebSocket reconnect test verifies a fresh non-empty snapshot precedes buffered
PTY output with exact-once ordering.
