/**
 * cli/src/tunnel/types.ts
 *
 * Pluggable tunnel backend interface (ADR 0003). The CLI's WebSocket server
 * listens on a local port; a {@link TunnelBackend} makes that port reachable
 * from elsewhere. The only shipped backend is {@link DevTunnelsBackend}.
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
   * e.g. `wss://<id>.devtunnels.ms`.
   */
  readonly url: string;
  /** Optional SHA-256 SPKI pin when a backend terminates TLS with a pinned cert. */
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
 * Shipped implementation: `DevTunnelsBackend`.
 */
export interface TunnelBackend {
  /** Backend identifier (e.g. `'devtunnels'`). */
  readonly id: string;
  /**
   * The host the local WebSocket server should bind to.
   * Dev Tunnels uses `'localhost'` (the helper forwards to that host).
   */
  readonly bindHost: string;
  /** Optional TLS identity when a backend terminates TLS on the Station itself. */
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
