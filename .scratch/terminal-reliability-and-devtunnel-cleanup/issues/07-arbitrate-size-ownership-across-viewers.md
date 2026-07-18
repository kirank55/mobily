# Arbitrate Terminal Size Ownership across multiple viewers

Status: ready-for-agent

## What to build

Extend Terminal Size Ownership from one Android device to multiple authenticated viewers. The Station must grant ownership to the most recently foregrounded Android terminal, keep non-owners fully interactive, and prevent non-owner resize requests from destabilizing the shared grid.

Ownership must be explicit, leased, and recoverable when a client disappears or reconnects.

## Acceptance criteria

- [ ] Exactly one viewer is the Terminal Size Owner at any moment.
- [ ] The most recently foregrounded authenticated Android terminal receives ownership.
- [ ] A previous owner is notified or can observe that ownership changed.
- [ ] Non-owning viewers continue receiving output and sending input.
- [ ] Non-owner resize requests are ignored or rejected without changing the Session grid.
- [ ] Lease expiry, disconnect, or explicit release transfers ownership to the next valid claimant or the Station.
- [ ] A reconnecting device cannot reclaim ownership without a new foreground claim.
- [ ] Multi-client real-WebSocket tests verify arbitration, continued interaction, rejected resize, lease expiry, and Station fallback deterministically.

## Blocked by

- [Issue 05](./05-transfer-size-ownership-to-foreground-android.md)
