/**
 * src/client/wsClient.ts
 *
 * WebSocket client with exponential backoff reconnect, Device Key
 * challenge-response auth, and hello/hello-ack version negotiation.
 *
 * Handshake sequence (mirrors cli/dev/smoke.html):
 *   hello → hello-ack → auth-challenge → auth-response → PTY stream
 *
 * Error classification:
 *   auth-rejection   — server rejected device key; permanent, needs re-pair
 *   version-mismatch — protocol version incompatible; needs app/CLI update
 *   station-offline  — can't connect at all; transient, will retry
 *   generic          — any other error
 */

import { signNonce } from '@/auth/deviceKey';

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

/** Structured error types for UX-specific messaging. */
export type ErrorKind =
  | 'auth-rejection'
  | 'version-mismatch'
  | 'station-offline'
  | 'biometric-cancelled'
  | 'generic';

export interface WsClientOptions {
  url: string;
  deviceId: string;
  protocolVersion: number;
  /** Callback for state changes. */
  onStateChange?: (state: ConnectionState, detail?: string) => void;
  /** Callback for output frames (PTY data). */
  onOutput?: (data: string) => void;
  /** Callback when the handshake completes (ready to send input). */
  onReady?: () => void;
  /** Callback for structured errors. */
  onError?: (message: string, kind?: ErrorKind) => void;
  /** Max reconnect attempts before failing. */
  maxRetries?: number;
}

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

/** WS close codes emitted by the CLI. */
const CLOSE_CODE_AUTH_REJECTED  = 4001;
const CLOSE_CODE_VERSION_MISMATCH = 4002;

export class WsClient {
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'disconnected';
  private retries = 0;
  private backoff = INITIAL_BACKOFF_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private deliberatelyClosed = false;
  private ready = false;
  /** Set to true when auth is permanently rejected (re-pair required). */
  private authRejected = false;

  constructor(private readonly opts: WsClientOptions) {}

  get currentState(): ConnectionState {
    return this.state;
  }

  get isReady(): boolean {
    return this.ready;
  }

  /** Open the connection and start the handshake. */
  connect(): void {
    this.deliberatelyClosed = false;
    this.authRejected = false;
    this.retries = 0;
    this.backoff = INITIAL_BACKOFF_MS;
    this.openSocket();
  }

  /** Close the connection permanently. */
  disconnect(): void {
    this.deliberatelyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState('disconnected');
  }

  /** Send an input frame (keystrokes / paste). Only after handshake. */
  sendInput(data: string): void {
    this.send({ type: 'input', data });
  }

  /** Send a resize frame. */
  sendResize(cols: number, rows: number): void {
    this.send({ type: 'resize', cols, rows });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internal
  // ─────────────────────────────────────────────────────────────────────────

  private openSocket(): void {
    this.ready = false;
    this.setState(this.retries > 0 ? 'reconnecting' : 'connecting');

    try {
      this.ws = new WebSocket(this.opts.url);
    } catch (err) {
      this.emitError(
        `Station unreachable — ${err instanceof Error ? err.message : 'network error'}`,
        'station-offline',
      );
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.send({ type: 'hello', protocolVersion: this.opts.protocolVersion });
    };

    this.ws.onmessage = (ev: MessageEvent) => {
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      void this.handleFrame(frame);
    };

    this.ws.onclose = (ev: CloseEvent) => {
      this.ready = false;
      if (this.deliberatelyClosed) {
        this.setState('disconnected');
        return;
      }

      // Classify the close code for UX-specific messages
      if (ev.code === CLOSE_CODE_AUTH_REJECTED) {
        this.authRejected = true;
        this.emitError('Device not recognized — scan QR to re-pair', 'auth-rejection');
        this.setState('failed', 'auth-rejection');
        return;
      }

      if (ev.code === CLOSE_CODE_VERSION_MISMATCH) {
        this.emitError('Please update the app or the CLI to the same version', 'version-mismatch');
        this.setState('failed', 'version-mismatch');
        return;
      }

      // Transient disconnection — retry
      const reason = ev.reason ? `: ${ev.reason}` : '';
      this.emitError(
        `Station unreachable${reason} — is the CLI running?`,
        'station-offline',
      );
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // The onclose handler fires right after onerror; no additional action needed here.
      // Avoid double-emitting by not calling onError here.
    };
  }

  private async handleFrame(frame: Record<string, unknown>): Promise<void> {
    const type = frame['type'] as string;

    switch (type) {
      case 'hello-ack':
        // Server acknowledged version — waiting for auth challenge
        break;

      case 'auth-challenge': {
        const nonce = frame['nonce'] as string;
        const signature = await signNonce(nonce);
        if (signature === null) {
          this.emitError('Biometric authentication cancelled', 'biometric-cancelled');
          this.ws?.close(1008, 'auth cancelled');
          this.setState('failed', 'biometric-cancelled');
          return;
        }
        this.send({ type: 'auth-response', deviceId: this.opts.deviceId, signature });
        break;
      }

      case 'output':
        this.opts.onOutput?.(frame['data'] as string);
        break;

      case 'error': {
        const msg = (frame['message'] as string | undefined) ?? 'Server error';
        const code = frame['code'] as string | undefined;

        // Classify server-sent error frames
        if (code === 'AUTH_REJECTED' || msg.toLowerCase().includes('not recognized')) {
          this.authRejected = true;
          this.emitError('Device not recognized — scan QR to re-pair', 'auth-rejection');
          this.setState('failed', 'auth-rejection');
        } else if (code === 'VERSION_MISMATCH' || msg.toLowerCase().includes('version')) {
          this.emitError('Please update the app or the CLI', 'version-mismatch');
          this.setState('failed', 'version-mismatch');
        } else {
          this.emitError(msg, 'generic');
        }
        break;
      }

      default:
        // Unknown frame — ignore
        break;
    }

    // First output frame means we're fully connected and streaming
    if (type === 'output' && !this.ready) {
      this.ready = true;
      this.retries = 0;
      this.backoff = INITIAL_BACKOFF_MS;
      this.setState('connected');
      this.opts.onReady?.();
    }
  }

  private scheduleReconnect(): void {
    // Don't retry permanent failures (auth rejection)
    if (this.authRejected) return;

    const maxRetries = this.opts.maxRetries ?? 10;
    if (this.retries >= maxRetries) {
      this.setState('failed', 'Max retries exceeded — is the CLI running?');
      return;
    }

    this.retries++;
    this.setState('reconnecting', `attempt ${this.retries}`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, this.backoff);

    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
  }

  private send(frame: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    }
  }

  private setState(state: ConnectionState, detail?: string): void {
    this.state = state;
    this.opts.onStateChange?.(state, detail);
  }

  private emitError(message: string, kind: ErrorKind = 'generic'): void {
    this.opts.onError?.(message, kind);
  }
}
