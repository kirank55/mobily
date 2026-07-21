# Record and normally delete each Temporary Tunnel

Status: resolved

## What to build

Deliver durable ownership for one Temporary Tunnel through its normal lifecycle. Mobily must atomically record the remote tunnel identity and owning CLI run before reporting the tunnel ready, delete it during normal shutdown, and remove the record only after confirmed or idempotent deletion.

The ownership boundary must be explicit: Mobily may clean only tunnels it recorded and must never infer ownership from the user's account-wide tunnel inventory.

## Acceptance criteria

- [x] Each newly created Temporary Tunnel has durable ownership metadata before Mobily reports it ready.
- [x] Ownership metadata includes the tunnel identity, owning run identity, creation time, and lifecycle state.
- [x] Ownership writes and removals are atomic and tolerate interrupted filesystem operations.
- [x] Normal shutdown stops the helper and explicitly deletes the recorded remote tunnel.
- [x] A provider response indicating that the tunnel is already absent counts as successful idempotent cleanup.
- [x] Successful deletion removes the ownership record; ambiguous or failed deletion retains it.
- [x] Unrecorded user-created tunnels are never deleted or adopted.
- [x] An injected lifecycle test covers record, ready, normal delete, already-missing delete, failure retention, and ownership isolation.
- [x] The tunnel architecture decision records Mobily's durable Temporary Tunnel ownership boundary.

## Blocked by

None - can start immediately

## Answer

Dev Tunnels now receive a durable, per-run ownership record under
`~/.mobily/temporary-tunnels/` after the helper exposes its remote identity and
before `connect()` returns the ready URL. Records contain the tunnel identity,
owning run identity, creation time, and `ready`/`deleting` lifecycle state.
Writes use a private temporary file, file sync, atomic rename, and best-effort
directory sync; record removal is an atomic unlink followed by directory sync.

Normal disconnect marks the owned record as deleting, stops the helper, and
explicitly deletes only that recorded identity. Confirmed and already-missing
deletions remove the record, while provider or record-removal failures retain
it for recovery. No provider inventory or adoption path exists.

The injected Dev Tunnels tests cover readiness ordering, recording failure,
normal cleanup, already-missing cleanup, failure retention, exact ownership
isolation, and the real file store's atomic lifecycle replacement. ADR 0003
now documents the durable Temporary Tunnel ownership boundary.
