# Bound CLI shutdown while preserving tunnel recovery

Status: resolved

## What to build

Route normal exit, handled termination signals, startup failure after tunnel creation, and uncaught top-level failure through one idempotent cleanup coordinator. The first shutdown request must visibly stop new work and wait up to ten seconds for Temporary Tunnel cleanup. A second request or deadline expiry must force exit while preserving durable recovery state.

## Acceptance criteria

- [x] Normal completion and supported termination signals enter the same idempotent cleanup path.
- [x] Startup failure after Temporary Tunnel creation and uncaught top-level failure also attempt bounded cleanup.
- [x] The first shutdown request stops accepting new work and displays Temporary Tunnel cleanup progress.
- [x] Cleanup has a deterministic ten-second upper bound.
- [x] A second shutdown request forces exit without waiting for the remaining deadline.
- [x] Timeout or forced exit preserves the ownership record for startup recovery.
- [x] Successful cleanup removes the record before exit.
- [x] Repeated shutdown events cannot run duplicate deletion or corrupt ownership state.
- [x] An injected CLI lifecycle test with fake signals and a deterministic clock covers normal exit, first signal, second signal, timeout, cleanup success, and cleanup failure.
- [x] User-facing shutdown errors remain concise and point to the next-run recovery behavior.

## Blocked by

- [Issue 09](./09-recover-stale-temporary-tunnels.md)

## Answer

The CLI now routes Session completion, SIGINT/SIGTERM, post-connect startup
failure, rejected top-level startup, uncaught exceptions, and unhandled
rejections through one injected lifecycle coordinator. Its first request stops
the workstation and server, reports Temporary Tunnel cleanup, and starts a
ten-second deadline. A second request or deadline expiry aborts record removal
and force-exits with a next-start recovery message.

Tunnel disconnect accepts the coordinator's abort signal and removes durable
ownership only after successful, non-aborted deletion. Deterministic lifecycle
tests cover normal completion, both signal requests, timeout, success, failure,
and top-level startup failure; the Dev Tunnels suite directly verifies
force-aborted ownership retention. ADR 0003 records the bounded shutdown and
recovery policy.
