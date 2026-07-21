# Recover stale Temporary Tunnels before creating another

Status: resolved

## What to build

Reconcile Mobily-owned stale Temporary Tunnels before creating a new Dev Tunnel. Recovery must distinguish stale records from tunnels owned by another live CLI run, treat missing tunnels as already cleaned, and stop remote tunnel creation when cleanup fails.

Provider cleanup failure must produce a precise recovery message without blocking explicit use of the secure local backend.

## Acceptance criteria

- [x] Dev Tunnel startup scans durable Mobily ownership records before requesting a new remote tunnel.
- [x] Records owned by another live CLI run are protected from recovery deletion.
- [x] Stale recorded tunnels are deleted before new Dev Tunnel creation.
- [x] An already-missing remote tunnel is reconciled successfully and its record is removed.
- [x] Failed cleanup retains the record and prevents any new Dev Tunnel creation attempt in that run.
- [x] The failure message identifies the affected tunnel and gives a concrete recovery action without exposing secrets.
- [x] Failed Dev Tunnel reconciliation does not prevent explicit startup with the secure local backend.
- [x] Recovery never invokes provider-wide bulk deletion and never touches unrecorded tunnels.
- [x] Deterministic concurrent-run and startup lifecycle tests cover live ownership, stale cleanup, idempotency, failure blocking, and local-backend availability.
- [x] Tunnel architecture documentation records recovery-before-create and the reason cleanup failure blocks another remote tunnel.

## Blocked by

- [Issue 08](./08-record-and-delete-temporary-tunnel.md)

## Answer

Dev Tunnels connection now lists only Mobily's durable ownership records and
reconciles stale entries immediately before requesting a remote tunnel. New
records include the owner process identity; a deterministic liveness seam
protects tunnels belonging to another running CLI process. Legacy records
without a process identity are treated as stale.

Recovery marks each stale record deleting, deletes only its recorded tunnel
identity, and removes the record after confirmed or idempotent provider
deletion. Any record update, provider deletion, or record removal failure
retains recovery state and blocks remote creation. Provider output is omitted
from the actionable error so credentials cannot be echoed. Local backend
selection remains independent.

The Dev Tunnels lifecycle suite covers stale-before-create ordering, live-owner
protection, missing-tunnel idempotency, failure retention and creation
blocking, and secure local availability. ADR 0003 now records the recovery
policy and quota-leak rationale.
