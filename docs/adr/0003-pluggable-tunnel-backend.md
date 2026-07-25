# Pluggable tunnel backend (Dev Tunnels shipped)

The tunneling layer is behind a `TunnelBackend` interface rather than hard-wired
into the CLI entrypoint. Microsoft Dev Tunnels is the only shipped backend:
running `npx mobily` always prepares and hosts through Dev Tunnels. The
interface remains so alternate backends (Bore, Cloudflare Tunnels, SSH reverse
tunnels, and similar) can be added later without rewriting Session or pairing
code.

## Secure phone transport: DevTunnelsBackend

**Dev Tunnels cannot be hosted anonymously** — the operator must authenticate
with a Microsoft/GitHub account. Anonymous access applies only to _connecting_
to a tunnel (the tunnel is opened with `--allow-anonymous`), and mobily gates
that connection with its own Device Key challenge-response auth. The phone never
needs a Microsoft account.

The operator authenticates once through Microsoft's official `devtunnel`
helper, choosing GitHub or Microsoft device-code login. The helper owns secure
credential caching; Mobily owns the guided first-run experience and temporary
tunnel lifecycle. Operator setup steps live in the root `README.md`.

### Durable Temporary Tunnel ownership

Every Dev Tunnel created by Mobily is a Temporary Tunnel. After the helper
returns its remote identity, Mobily atomically writes a private ownership record
under `~/.mobily/temporary-tunnels/` before exposing the tunnel URL. A record
contains the tunnel identity, a distinct CLI run identity, its creation time,
its owning process identity, and its lifecycle state (`ready` or `deleting`).

Normal shutdown first marks that exact record as deleting, stops the helper,
and explicitly asks the provider to delete that tunnel identity. Provider
"not found" responses are successful idempotent cleanup. The record is removed
only after confirmed or idempotent deletion; ambiguous failures retain it for
recovery.

This record is Mobily's ownership boundary. Cleanup may address only identities
from records Mobily wrote. It must not list the account's tunnels to infer
ownership, adopt an unrecorded tunnel, or issue provider-wide deletion.

Before Mobily creates a new Dev Tunnel, it scans these records and checks the
owning process. Records belonging to another live CLI run are left untouched.
For each stale record, Mobily marks it deleting, deletes that exact tunnel, and
then removes the record. A provider "not found" result is successful recovery,
which makes repeated recovery idempotent.

If any stale tunnel cannot be deleted or its durable record cannot be updated,
Mobily retains the record and refuses to create another Dev Tunnel in that run.
Creating another remote resource would compound the leak and can exhaust the
account quota. The error identifies the tunnel and gives a specific manual
delete or local-record recovery action without reproducing provider output,
which may contain credentials.

### Bounded shutdown and recovery

Normal Session completion, handled termination signals, startup failures after
tunnel creation, and top-level failures use one idempotent CLI cleanup
coordinator. The first shutdown request immediately stops accepting new work,
shows Temporary Tunnel cleanup progress, and gives the complete cleanup
operation ten seconds. A second request or deadline expiry force-exits without
waiting for the provider.

Forced or failed cleanup aborts removal of the durable ownership record, even
if an in-flight provider deletion finishes afterward. The next CLI run can
therefore reconcile the exact recorded tunnel before creating another one.
Only successful cleanup within the deadline removes the record.

## Why the interface exists

Driven by FOSS goals: an open-source project shouldn't permanently hard-wire a
single proprietary service into Session and pairing code. The interface is small
(`connect(localPort)` → `TunnelConnection { url, certificatePin?, disconnect() }`,
plus `bindHost` and an optional server TLS identity), so adding backends later
is incremental.

**Considered alternatives:**

- **Dev Tunnels with anonymous hosting (original plan)** — the original ADR
  assumed Dev Tunnels could be hosted anonymously for zero-setup `npx mobily`.
  Microsoft's docs confirm this is not possible: hosting always requires
  authentication.
- **LocalBackend (pinned TLS on LAN)** — previously shipped as an account-free
  same-Wi-Fi path (`--tunnel local`). Removed so Mobily has a single supported
  transport (Dev Tunnels) with no tunnel-selection flag.
- **Bore / Cloudflare / SSH** — fully open-source or self-hostable options that
  can be added as future backends behind the same interface.
- **No abstraction** — simpler code, but paints the project into a corner if a
  contributor wants an alternative provider.
