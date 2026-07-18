# Record and normally delete each Temporary Tunnel

Status: ready-for-agent

## What to build

Deliver durable ownership for one Temporary Tunnel through its normal lifecycle. Mobily must atomically record the remote tunnel identity and owning CLI run before reporting the tunnel ready, delete it during normal shutdown, and remove the record only after confirmed or idempotent deletion.

The ownership boundary must be explicit: Mobily may clean only tunnels it recorded and must never infer ownership from the user's account-wide tunnel inventory.

## Acceptance criteria

- [ ] Each newly created Temporary Tunnel has durable ownership metadata before Mobily reports it ready.
- [ ] Ownership metadata includes the tunnel identity, owning run identity, creation time, and lifecycle state.
- [ ] Ownership writes and removals are atomic and tolerate interrupted filesystem operations.
- [ ] Normal shutdown stops the helper and explicitly deletes the recorded remote tunnel.
- [ ] A provider response indicating that the tunnel is already absent counts as successful idempotent cleanup.
- [ ] Successful deletion removes the ownership record; ambiguous or failed deletion retains it.
- [ ] Unrecorded user-created tunnels are never deleted or adopted.
- [ ] An injected lifecycle test covers record, ready, normal delete, already-missing delete, failure retention, and ownership isolation.
- [ ] The tunnel architecture decision records Mobily's durable Temporary Tunnel ownership boundary.

## Blocked by

None - can start immediately
