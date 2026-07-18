# Recover stale Temporary Tunnels before creating another

Status: ready-for-agent

## What to build

Reconcile Mobily-owned stale Temporary Tunnels before creating a new Dev Tunnel. Recovery must distinguish stale records from tunnels owned by another live CLI run, treat missing tunnels as already cleaned, and stop remote tunnel creation when cleanup fails.

Provider cleanup failure must produce a precise recovery message without blocking explicit use of the secure local backend.

## Acceptance criteria

- [ ] Dev Tunnel startup scans durable Mobily ownership records before requesting a new remote tunnel.
- [ ] Records owned by another live CLI run are protected from recovery deletion.
- [ ] Stale recorded tunnels are deleted before new Dev Tunnel creation.
- [ ] An already-missing remote tunnel is reconciled successfully and its record is removed.
- [ ] Failed cleanup retains the record and prevents any new Dev Tunnel creation attempt in that run.
- [ ] The failure message identifies the affected tunnel and gives a concrete recovery action without exposing secrets.
- [ ] Failed Dev Tunnel reconciliation does not prevent explicit startup with the secure local backend.
- [ ] Recovery never invokes provider-wide bulk deletion and never touches unrecorded tunnels.
- [ ] Deterministic concurrent-run and startup lifecycle tests cover live ownership, stale cleanup, idempotency, failure blocking, and local-backend availability.
- [ ] Tunnel architecture documentation records recovery-before-create and the reason cleanup failure blocks another remote tunnel.

## Blocked by

- [Issue 08](./08-record-and-delete-temporary-tunnel.md)
