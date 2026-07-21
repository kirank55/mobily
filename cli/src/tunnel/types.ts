/**
 * cli/src/tunnel/types.ts
 *
 * Pluggable tunnel backend interface (ADR 0003). The CLI's WebSocket server
 * listens on a local port; a {@link TunnelBackend} makes that port reachable
 * from elsewhere — over a certificate-pinned LAN (`LocalBackend`)
 * or the public internet (`DevTunnelsBackend`).
 *
 * The interface is deliberately small. The caller:
 *   1. Binds the WS server to `backend.bindHost`.
 *   2. Calls `connect(localPort)` to establish the tunnel.
 *   3. Receives a {@link TunnelConnection} with the URL clients should use.
 *   4. Calls `connection.disconnect()` during shutdown.
 */

/** An established tunnel: a URL clients connect to, plus a way to tear it down. */
export interface TunnelConnection {
  /**
   * The URL clients should connect to.
   * e.g. `ws://192.168.1.5:4321` (local) or `wss://<id>.devtunnels.ms` (remote).
   */
  readonly url: string;
  /** Dynamic SHA-256 SPKI pin for a self-signed local Station certificate. */
  readonly certificatePin?: string;
  /**
   * Tear down the tunnel. Safe to call multiple times. When shutdown is
   * forced, an aborted signal prevents durable recovery state from being
   * removed even if an in-flight provider deletion finishes afterward.
   */
  disconnect(signal?: AbortSignal): Promise<void>;
}

/**
 * A strategy for making the CLI's local WebSocket server reachable.
 * Implementations: {@link LocalBackend} (secure LAN),
 * `DevTunnelsBackend` (secure phone transport).
 */
export interface TunnelBackend {
  /** Backend identifier (e.g. `'local'`, `'devtunnels'`). */
  readonly id: string;
  /**
   * The host the local WebSocket server should bind to.
   * `'0.0.0.0'` for local (reachable on LAN), `'localhost'` for remote
   * (tunnel forwards to localhost).
   */
  readonly bindHost: string;
  /** TLS identity used directly by a local Station server. */
  readonly serverTls?: {
    readonly key: string;
    readonly cert: string;
    readonly certificatePin: string;
  };
  /**
   * Establish the tunnel, forwarding remote traffic to `localPort`. Resolves
   * with a {@link TunnelConnection} once the tunnel is up.
   */
  connect(localPort: number): Promise<TunnelConnection>;
}
