# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security reports.

Email the maintainer with:

- A description of the issue and its impact
- Steps to reproduce or a proof of concept when possible
- Affected versions / commit hashes if known

Use the email address listed on the [GitHub profile](https://github.com/kirank55) for private contact, or open a private [GitHub Security Advisory](https://github.com/kirank55/mobily/security/advisories/new) if you have access.

We aim to acknowledge reports within a few days and will coordinate a fix and disclosure timeline with you.

## Threat model (summary)

Mobily streams a live workstation terminal to a paired Android device.

- **Device Key pairing.** The phone holds a non-exportable private key in Android Keystore. The Station stores the public key and verifies challenge-response signatures before streaming terminal data or accepting input.
- **No Mobily-operated terminal relay.** Terminal bytes travel over the tunnel you configure (local pinned TLS on LAN, or Microsoft Dev Tunnels for remote access). Mobily does not operate a cloud that sees your PTY stream.
- **Dev Tunnels.** Remote mode uses Microsoft’s `devtunnel` helper and that provider’s authentication. Treat that path as part of your trust boundary.
- **Local TLS.** `--tunnel local` uses a long-lived self-signed Station certificate with a SHA-256 pin embedded in the pairing QR. Keep the Station and phone on a network you trust.
- **Session capabilities.** A paired phone can drive the shared terminal and (when enabled) Git RPC against the Station’s working directory. Revoke Device Key bindings with `mobily --revoke-binding <id>` if a device is lost.

## Supported versions

Security fixes target the latest published `mobily` CLI release on npm and the corresponding Android build from this repository. Older pre-1.0 versions may not receive backports.

## Related notes

Maintainer dependency-audit exceptions live in [docs/dependency-audits.md](docs/dependency-audits.md).
