/**
 * src/client/wsClient.ts
 *
 * WebSocket client with exponential backoff reconnect, Device Key
 * challenge-response auth, and hello/hello-ack version negotiation.
 *
 * Handshake sequence (mirrors cli/dev/smoke.html):
 *   hello → hello-ack → auth-challenge → auth-response → PTY stream
 */

import { signNonce } from '@/auth/deviceKey';

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

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
  /** Callback for error frames or handshake failures. */
  onError?: (message: string) => void;
  /** Max reconnect attempts before failing. */
  maxRetries?: number;
}

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

export class WsClient {
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'disconnected';
  private retries = 0;
  private backoff = INITIAL_BACKOFF_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private deliberatelyClosed = false;
  private ready = false;

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

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private openSocket(): void {
    this.ready = false;
    this.setState(this.retries > 0 ? 'reconnecting' : 'connecting');

    try {
      this.ws = new WebSocket(this.opts.url);
    } catch (err) {
      this.opts.onError?.(`Cannot create WebSocket — ${err instanceof Error ? err.message : 'error'}`);
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
      this.handleFrame(frame);
    };

    this.ws.onclose = (ev: CloseEvent) => {
      this.ready = false;
      if (this.deliberatelyClosed) {
        this.setState('disconnected');
        return;
      }
      const reason = ev.reason ? `: ${ev.reason}` : '';
      this.opts.onError?.(`Disconnected (code ${ev.code}${reason})`);
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.opts.onError?.('WebSocket error');
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
          this.opts.onError?.('Biometric authentication cancelled');
          this.ws?.close(1008, 'auth cancelled');
          this.setState('failed');
          return;
        }
        this.send({ type: 'auth-response', deviceId: this.opts.deviceId, signature });
        break;
      }

      case 'output':
        this.opts.onOutput?.(frame['data'] as string);
        break;

      case 'error':
        this.opts.onError?.(frame['message'] as string ?? 'Server error');
        break;

      default:
        // Unknown frame — ignore
        break;
    }

    // First output frame means we're connected and streaming
    if (type === 'output' && !this.ready) {
      this.ready = true;
      this.retries = 0;
      this.backoff = INITIAL_BACKOFF_MS;
      this.setState('connected');
      this.opts.onReady?.();
    }
  }

  private scheduleReconnect(): void {
    const maxRetries = this.opts.maxRetries ?? 10;
    if (this.retries >= maxRetries) {
      this.setState('failed', `Max retries (${maxRetries}) exceeded`);
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
}
