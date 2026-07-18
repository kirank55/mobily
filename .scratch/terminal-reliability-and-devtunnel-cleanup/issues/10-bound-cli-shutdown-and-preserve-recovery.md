# Bound CLI shutdown while preserving tunnel recovery

Status: ready-for-agent

## What to build

Route normal exit, handled termination signals, startup failure after tunnel creation, and uncaught top-level failure through one idempotent cleanup coordinator. The first shutdown request must visibly stop new work and wait up to ten seconds for Temporary Tunnel cleanup. A second request or deadline expiry must force exit while preserving durable recovery state.

## Acceptance criteria

- [ ] Normal completion and supported termination signals enter the same idempotent cleanup path.
- [ ] Startup failure after Temporary Tunnel creation and uncaught top-level failure also attempt bounded cleanup.
- [ ] The first shutdown request stops accepting new work and displays Temporary Tunnel cleanup progress.
- [ ] Cleanup has a deterministic ten-second upper bound.
- [ ] A second shutdown request forces exit without waiting for the remaining deadline.
- [ ] Timeout or forced exit preserves the ownership record for startup recovery.
- [ ] Successful cleanup removes the record before exit.
- [ ] Repeated shutdown events cannot run duplicate deletion or corrupt ownership state.
- [ ] An injected CLI lifecycle test with fake signals and a deterministic clock covers normal exit, first signal, second signal, timeout, cleanup success, and cleanup failure.
- [ ] User-facing shutdown errors remain concise and point to the next-run recovery behavior.

## Blocked by

- [Issue 09](./09-recover-stale-temporary-tunnels.md)
