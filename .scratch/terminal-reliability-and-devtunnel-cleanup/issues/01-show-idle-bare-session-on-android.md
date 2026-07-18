# Show an idle bare-PTY Session on first Android connection

Status: ready-for-agent

## What to build

Deliver the first complete Session Snapshot path for a bare PTY. The Station must maintain enough canonical terminal state to send an authenticated Android client a complete visible frame before live output. Android must show an explicit loading state until that frame arrives and then render the current idle Session without requiring the user to type a command.

Output produced while the snapshot is prepared must follow it without loss or duplication. Advance protocol negotiation so older peers fail clearly instead of silently using incomplete behavior.

## Acceptance criteria

- [x] A newly authenticated Android client receives an atomic Session Snapshot containing the visible grid, styling, cursor state, active screen, and dimensions.
- [x] Authentication success and ownership/size state precede the Session Snapshot; live output follows it.
- [x] Output emitted while the snapshot is prepared is delivered exactly once after the snapshot.
- [x] Android shows a loading state before the first snapshot and a nonblank current screen immediately after applying it.
- [x] A bare PTY that emitted its prompt before Android connected is reconstructed without requiring new PTY output.
- [x] Malformed, oversized, unauthenticated, and version-incompatible snapshot traffic is rejected safely.
- [x] A deterministic real-PTY/WebSocket integration test and production-terminal browser test fail on the previous blank-screen behavior and pass with this slice.
- [x] The terminal-session architecture decision records the canonical screen model and snapshot-before-live-output contract.

## Blocked by

None - can start immediately
