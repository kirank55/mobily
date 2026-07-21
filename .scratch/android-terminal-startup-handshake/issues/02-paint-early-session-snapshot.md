# Paint an early Session Snapshot after late renderer readiness

Status: ready-for-agent

## Parent

[Reliable Android Terminal Startup Handshake](../spec.md)

## What to build

Complete the authenticated startup path when the Station publishes its initial Session Snapshot before the terminal route mounts or before xterm becomes ready.

The Station connection must retain the latest authenticated Session Snapshot, replay it to a late terminal subscriber, and deliver it again when renderer readiness is re-announced before first-paint acknowledgement. The terminal must apply the frame atomically, acknowledge first paint, transition from loading to live, and preserve the existing snapshot-before-scrollback ordering.

The retained snapshot belongs to one Station connection and must be cleared when disconnecting or beginning a connection to a different Station.

## Acceptance criteria

- [ ] A Session Snapshot received before the terminal route subscribes is retained rather than dropped.
- [ ] A late terminal subscriber immediately receives the latest authenticated Session Snapshot.
- [ ] A Session Snapshot received before xterm readiness is delivered after the renderer becomes ready.
- [ ] Re-announced readiness safely re-delivers the pending Session Snapshot until first-paint acknowledgement.
- [ ] Duplicate pre-ack snapshot delivery does not mix frames, duplicate live output, or corrupt terminal state.
- [ ] Snapshot application remains atomic and produces a nonblank first frame for idle shells and full-screen terminal applications.
- [ ] The terminal remains in loading state until the WebView sends snapshot-applied acknowledgement.
- [ ] Snapshot-applied acknowledgement transitions the terminal to live and permits the existing bounded scrollback transfer.
- [ ] Live output and scrollback cannot overtake or overwrite the initial Session Snapshot.
- [ ] Disconnect clears retained startup snapshot state.
- [ ] Connecting to a different Station clears the previous Station’s retained snapshot before any subscriber can receive it.
- [ ] Reconnect preserves the last rendered frame until a replacement Session Snapshot is applied.
- [ ] A deterministic end-to-end startup test authenticates and publishes a Session Snapshot before route subscription, delays renderer readiness, then verifies rendered content and live state.
- [ ] A focused latest-snapshot subscription test verifies late replay and stale-state reset.

## Blocked by

- [Issue 01](./01-establish-renderer-ready-handshake.md)
