# Arbitrate Terminal Size Ownership across multiple viewers

Status: resolved

## What to build

Extend Terminal Size Ownership from one Android device to multiple authenticated viewers. The Station must grant ownership to the most recently foregrounded Android terminal, keep non-owners fully interactive, and prevent non-owner resize requests from destabilizing the shared grid.

Ownership must be explicit, leased, and recoverable when a client disappears or reconnects.

## Acceptance criteria

- [x] Exactly one viewer is the Terminal Size Owner at any moment.
- [x] The most recently foregrounded authenticated Android terminal receives ownership.
- [x] A previous owner is notified or can observe that ownership changed.
- [x] Non-owning viewers continue receiving output and sending input.
- [x] Non-owner resize requests are ignored or rejected without changing the Session grid.
- [x] Lease expiry, disconnect, or explicit release transfers ownership to the next valid claimant or the Station.
- [x] A reconnecting device cannot reclaim ownership without a new foreground claim.
- [x] Multi-client real-WebSocket tests verify arbitration, continued interaction, rejected resize, lease expiry, and Station fallback deterministically.

## Blocked by

- [Issue 05](./05-transfer-size-ownership-to-foreground-android.md)

## Answer

The Session now tracks every foreground socket claim with a stable recency
sequence and an independent renewable lease. A new claim becomes owner, while
lease refreshes preserve the original foreground order so periodic Android
refreshes cannot make viewers fight. Removing the owner by release, disconnect,
or expiry selects the newest remaining valid claimant; Station dimensions are
restored only when the claimant set is empty.

Requester-specific owner state is broadcast to every authenticated connection,
so preempted viewers observe the transition. Their input and output paths remain
unchanged, while resize frames continue to be accepted only from the current
owner.

Coverage includes deterministic recording-backend WebSocket arbitration and an
authenticated real-PTY/multi-WebSocket flow covering takeover, previous-owner
notification, non-owner interaction and rejected resize, explicit fallback,
lease fallback, disconnect, Station restoration, and reconnect without an
implicit claim. ADR 0004 now records the multi-viewer claimant semantics.
