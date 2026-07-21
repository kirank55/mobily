# Mobily

A mobile remote-control app for terminal-based development environments, streaming live sessions from a developer's workstation to an Android device over a secure tunnel.

## Language

**CLI**:
The Node.js process running on the developer's workstation that spawns PTY sessions, manages tunnels, and serves the WebSocket API. Ships as an `npx` package. Source lives in `cli/`.
_Avoid_: Host, server, agent, daemon

**Station**:
The developer's physical or virtual machine where the CLI runs and code lives.
_Avoid_: Host (overloaded with networking/tunneling meaning)

**Device Key**:
A non-exportable cryptographic keypair generated in Android Keystore on first pairing. The public key is sent to the CLI; the private key never leaves Android Keystore. The app reports whether the key is backed by a trusted execution environment or StrongBox because secure-hardware backing depends on the device. On reconnect, the device signs a challenge to prove identity.
_Avoid_: Device fingerprint, device ID, device UUID

**Device Binding ID**:
A cryptographically random, non-secret identifier for one Device Key binding on a Station. It selects the public key used to verify a reconnect; it is not authentication by itself.
_Avoid_: Device ID, UUID, fingerprint

**Session**:
A persistent terminal interaction on the Station. When `tmux` is available, backed by a tmux session (survives CLI crash). When `tmux` is absent, backed by the CLI process's PTY (survives client disconnects, but not CLI crash).
_Avoid_: Connection (that's the WebSocket link, not the terminal session)

**Terminal Size Owner**:
The single active viewer whose geometry defines a Session's terminal grid. The Station owns dimensions by default. Android does not claim ownership; it scales the Station grid into the phone viewport (Fit) and leaves readability to user zoom/pan.
_Avoid_: Authoritative grid, primary terminal

**Session Snapshot**:
An atomic representation of a Session's visible terminal cells, styling, cursor position, and grid dimensions at a point in time. A newly authenticated viewer receives it before live terminal output.
_Avoid_: Replay, scrollback

**Tunnel**:
The secure relay that makes the CLI's WebSocket server reachable from the public internet. Pluggable — default is Dev Tunnels (anonymous), but users can swap to Bore, Cloudflare, SSH, or local network via a `TunnelBackend` interface.
_Avoid_: Proxy, relay (too generic)

**Temporary Tunnel**:
A Tunnel created and recorded by Mobily for the lifetime of a CLI run. Mobily removes it during orderly shutdown or stale-resource recovery and never treats an unrecorded user-created tunnel as its own.
_Avoid_: Dev Tunnel, orphaned tunnel

**Pairing Code**:
A short alphanumeric code (6-8 chars) displayed as a terminal QR code during first-time setup. The phone scans the QR, sends the code to the CLI's HTTPS pairing endpoint, and receives the full connection payload (tunnel URL, key exchange) in response. The code is single-use.
_Avoid_: Pairing token (the token is exchanged over HTTPS, not in the QR)
