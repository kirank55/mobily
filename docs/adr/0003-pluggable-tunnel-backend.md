# Pluggable tunnel backend with explicit secure transport selection

The tunneling layer is behind a `TunnelBackend` interface rather than hard-wired
to a single provider. There is no implicit tunnel default. Microsoft Dev
Tunnels is the supported secure remote transport. `LocalBackend` provides an
account-free secure phone path on the same LAN.

## Secure local transport: LocalBackend (LAN)

`LocalBackend` binds the Station to `0.0.0.0` and exposes it at
`wss://<lan-ip>:<port>`. The Station creates and persists a self-signed TLS
identity in `~/.mobily/local-tls.json`; its SHA-256 SPKI pin is carried in the
endpoint-bound pairing QR. A small native Android OkHttp transport verifies the
dynamic pin for pairing HTTPS and terminal WSS, so neither a public CA nor an
account is required. `--allow-insecure-local` explicitly downgrades this to
plaintext for the browser smoke harness only; production Android rejects it.

## Secure phone transport: DevTunnelsBackend

Dev Tunnels is the remote path, enabled via `--tunnel devtunnels`. **Dev Tunnels
cannot be hosted anonymously** — the operator must authenticate with a
Microsoft/GitHub account. Anonymous access applies only to _connecting_ to a
tunnel (the tunnel is opened with `--allow-anonymous`), and mobily gates that
connection with its own Device Key challenge-response auth. The phone never
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
which may contain credentials. This reconciliation is part of the Dev Tunnels
backend only; explicitly selecting the secure local backend remains available.

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

Driven by FOSS goals: an open-source project shouldn't force users onto a single
proprietary service. The interface is small (`connect(localPort)` →
`TunnelConnection { url, certificatePin?, disconnect() }`, plus `bindHost` and
an optional server TLS identity), so adding backends
for Bore, Cloudflare Tunnels, SSH reverse tunnels, or other providers is
incremental.

**Considered alternatives:**

- **Dev Tunnels with anonymous hosting (original plan)** — the original ADR
  assumed Dev Tunnels could be hosted anonymously for zero-setup `npx mobily`.
  Microsoft's docs confirm this is not possible: hosting always requires
  authentication. Corrected first to LocalBackend as the default, then to
  explicit tunnel selection after the plaintext transport review. Phase 3.1
  subsequently made the local default encrypted and certificate-pinned.
- **Dev Tunnels with MSA auth (hard-wired, default)** — stable URLs, but forces
  a Microsoft account on every operator and locks the project to one provider.
  Rejected for the same FOSS reasons; kept as an opt-in backend.
- **Bore as default** — fully open-source and self-hostable, but requires
  running a relay server or depending on a third-party community relay. Higher
  setup friction than LocalBackend. Can be added as a future backend.
- **No abstraction, just local** — simpler code, but paints the project into a
  corner if a contributor wants a remote path or an alternative provider.
