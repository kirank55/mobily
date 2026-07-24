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
import {
  decodeFrame,
  encodeFrame,
  isSecureWebSocketUrl,
  MAX_SESSION_SCROLLBACK_CHARS,
  WS_CLOSE_CODES,
  type Frame,
  type RpcRequestFrame,
  type RpcResponseFrame,
  type RpcStreamFrame,
  type SessionPhase,
  type SessionSnapshotFrame,
  type TerminalSizeOwnerFrame,
} from '@mobily/shared';
import { PinnedWebSocket } from './pinnedTransport';

export type ConnectionState =
  'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

/** Structured error types for UX-specific messaging. */
export type ErrorKind =
  | 'auth-rejection'
  | 'version-mismatch'
  | 'station-offline'
  | 'biometric-cancelled'
  | 'biometric-error'
  | 'device-key-error'
  | 'generic';

export interface WsClientOptions {
  url: string;
  deviceBindingId: string;
  /** Android Keystore alias for this Station's Device Key. */
  keyAlias?: string;
  protocolVersion: number;
  /** Callback for state changes. */
  onStateChange?: (state: ConnectionState, detail?: string) => void;
  /** Callback for output frames (PTY data). */
  onOutput?: (data: string, latencyTags?: readonly string[]) => void;
  /** Callback when the Station publishes the current Session grid. */
  onResize?: (cols: number, rows: number) => void;
  /** Callback for the atomic first terminal frame after authentication. */
  onSnapshot?: (snapshot: SessionSnapshotFrame) => void;
  /** Callback after one complete, validated Session history transfer. */
  onScrollback?: (data: string) => void;
  /** Callback for Terminal Size Ownership grant and restoration state. */
  onTerminalSizeOwner?: (state: Omit<TerminalSizeOwnerFrame, 'type'>) => void;
  /** Callback when the Station detects terminal output that needs attention. */
  onAlert?: (message: string) => void;
  /** Callback when the Station publishes a heuristic Session activity phase. */
  onSessionStatus?: (phase: SessionPhase, detail?: string) => void;
  /** Callback for structured RPC responses after authentication. */
  onRpcFrame?: (frame: RpcResponseFrame | RpcStreamFrame) => void;
  /** Callback when the handshake completes (ready to send input). */
  onReady?: () => void;
  /** Callback for structured errors. */
  onError?: (message: string, kind?: ErrorKind) => void;
  /** Max reconnect attempts before failing. */
  maxRetries?: number;
  /** Permit ws:// only in explicitly configured development builds. */
  allowInsecureTransport?: boolean;
  /** SHA-256 SPKI pin for a self-signed local Station. */
  certificatePin?: string;
}

interface SocketLike {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

function deviceKeyRequiresRepair(error: unknown): boolean {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
  if (code === 'ERR_DEVICE_KEY_INVALIDATED' || code === 'ERR_DEVICE_KEY_UNAVAILABLE') {
    return true;
  }
  if (code === 'ERR_BIOMETRIC_AUTHENTICATION') {
    return false;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /invalidated|unavailable|could not be recovered|pair this Station again/i.test(message);
}

type HandshakeState =
  | 'idle'
  | 'awaiting-hello-ack'
  | 'awaiting-challenge'
  | 'signing-challenge'
  | 'awaiting-auth-ok'
  | 'awaiting-snapshot'
  | 'ready';

export class WsClient {
  private ws: SocketLike | null = null;
  private state: ConnectionState = 'disconnected';
  private retries = 0;
  private backoff = INITIAL_BACKOFF_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private deliberatelyClosed = false;
  private reconnectSuppressed = false;
  private ready = false;
  private socketGeneration = 0;
  private handshakeState: HandshakeState = 'idle';
  private receivedInitialSize = false;
  private snapshotPaintAcknowledged = false;
  private scrollbackTransfer:
    { transferId: string; nextSequence: number; chunks: string[]; chars: number } | undefined;
  private completedScrollbackTransferId: string | undefined;
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
    console.info('[Mobily][Connection] Connecting to paired Station');
    this.deliberatelyClosed = false;
    this.reconnectSuppressed = false;
    this.authRejected = false;
    this.retries = 0;
    this.backoff = INITIAL_BACKOFF_MS;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const insecureDevelopmentOverride = __DEV__ && this.opts.allowInsecureTransport === true;
    if (!isSecureWebSocketUrl(this.opts.url) && !insecureDevelopmentOverride) {
      this.emitError('Refusing insecure Station transport', 'generic');
      this.setState('failed', 'insecure transport');
      return;
    }
    this.openSocket();
  }

  /** Close the connection permanently. */
  disconnect(): void {
    this.deliberatelyClosed = true;
    this.socketGeneration++;
    this.handshakeState = 'idle';
    this.receivedInitialSize = false;
    this.resetScrollbackState();
    this.ready = false;
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
  sendInput(data: string, latencyTag?: string): void {
    if (this.ready) this.send({ type: 'input', data, latencyTag });
  }

  /** Send a resize frame. */
  sendResize(cols: number, rows: number): void {
    if (this.ready) this.send({ type: 'resize', cols, rows });
  }

  claimTerminalSize(): void {
    if (this.ready) this.send({ type: 'terminal-size-claim' });
  }

  releaseTerminalSize(): void {
    if (this.ready) this.send({ type: 'terminal-size-release' });
  }

  /** Confirm first paint so the Station may begin the bounded history transfer. */
  acknowledgeSnapshotApplied(): void {
    if (!this.ready || this.snapshotPaintAcknowledged) return;
    this.snapshotPaintAcknowledged = true;
    this.send({ type: 'session-snapshot-applied' });
  }

  /** Send a structured request after authentication. */
  sendRpc(frame: RpcRequestFrame): boolean {
    if (!this.ready) return false;
    this.send(frame);
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internal
  // ─────────────────────────────────────────────────────────────────────────

  private openSocket(): void {
    this.ready = false;
    this.receivedInitialSize = false;
    this.resetScrollbackState();
    this.reconnectSuppressed = false;
    this.setState(this.retries > 0 ? 'reconnecting' : 'connecting');

    let socket: SocketLike;
    try {
      socket = this.opts.certificatePin
        ? new PinnedWebSocket(this.opts.url, this.opts.certificatePin)
        : (new WebSocket(this.opts.url) as unknown as SocketLike);
    } catch (err) {
      this.emitError(
        `Station unreachable — ${err instanceof Error ? err.message : 'network error'}`,
        'station-offline',
      );
      this.scheduleReconnect();
      return;
    }
    const generation = ++this.socketGeneration;
    this.ws = socket;
    this.handshakeState = 'awaiting-hello-ack';

    socket.onopen = () => {
      if (!this.isCurrentSocket(socket, generation)) return;
      console.info('[Mobily][Connection] Socket opened; starting protocol negotiation');
      this.sendOn(socket, { type: 'hello', protocolVersion: this.opts.protocolVersion });
    };

    socket.onmessage = (ev: { data: unknown }) => {
      if (!this.isCurrentSocket(socket, generation)) return;
      let frame: Frame;
      try {
        if (typeof ev.data !== 'string') throw new TypeError('non-text frame');
        frame = decodeFrame(ev.data);
      } catch {
        socket.close(WS_CLOSE_CODES.MALFORMED_FRAME, 'malformed frame');
        return;
      }
      void this.handleFrame(frame, socket, generation);
    };

    socket.onclose = (ev: { code: number; reason: string }) => {
      if (!this.isCurrentSocket(socket, generation)) return;
      this.ws = null;
      this.ready = false;
      this.handshakeState = 'idle';
      if (this.deliberatelyClosed) {
        this.setState('disconnected');
        return;
      }
      if (this.reconnectSuppressed) return;

      // Classify the close code for UX-specific messages
      if (ev.code === WS_CLOSE_CODES.AUTH_REJECTED) {
        this.authRejected = true;
        this.emitError('Device not recognized — scan QR to re-pair', 'auth-rejection');
        this.setState('failed', 'auth-rejection');
        return;
      }

      if (ev.code === WS_CLOSE_CODES.VERSION_MISMATCH) {
        this.emitError('Please update the app or the CLI to the same version', 'version-mismatch');
        this.setState('failed', 'version-mismatch');
        return;
      }

      // Transient disconnection — retry
      const reason = ev.reason ? `: ${ev.reason}` : '';
      this.emitError(`Station unreachable${reason} — is the CLI running?`, 'station-offline');
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      // The onclose handler fires right after onerror; no additional action needed here.
      // Avoid double-emitting by not calling onError here.
    };
  }

  private async handleFrame(frame: Frame, socket: SocketLike, generation: number): Promise<void> {
    if (!this.isCurrentSocket(socket, generation)) return;

    switch (frame.type) {
      case 'hello-ack': {
        if (
          this.handshakeState !== 'awaiting-hello-ack' ||
          frame.protocolVersion !== this.opts.protocolVersion
        ) {
          socket.close(
            frame.protocolVersion === this.opts.protocolVersion
              ? WS_CLOSE_CODES.PROTOCOL_ERROR
              : WS_CLOSE_CODES.VERSION_MISMATCH,
            'invalid hello acknowledgement',
          );
          return;
        }
        this.handshakeState = 'awaiting-challenge';
        console.info('[Mobily][Connection] Protocol negotiation completed');
        break;
      }

      case 'auth-challenge': {
        if (this.handshakeState !== 'awaiting-challenge') {
          socket.close(WS_CLOSE_CODES.PROTOCOL_ERROR, 'unexpected auth challenge');
          return;
        }
        this.handshakeState = 'signing-challenge';
        console.info('[Mobily][Connection] Station requested Device Key authentication');
        let signature: string | null;
        try {
          signature = await signNonce(
            frame.nonce,
            'Authenticate to connect to your Station',
            this.opts.keyAlias,
          );
        } catch (error) {
          console.error('[Mobily][Connection] Device Key signing failed', error);
          if (
            !this.isCurrentSocket(socket, generation) ||
            this.handshakeState !== 'signing-challenge'
          ) {
            return;
          }
          const requiresRepair = deviceKeyRequiresRepair(error);
          const message = requiresRepair
            ? 'Device Key is unavailable or invalidated. Scan QR to pair again.'
            : 'Biometric authentication failed. Retry when the device is ready.';
          const kind: ErrorKind = requiresRepair ? 'device-key-error' : 'biometric-error';
          this.reconnectSuppressed = true;
          this.emitError(message, kind);
          this.setState('failed', message);
          socket.close(1008, requiresRepair ? 'device key error' : 'biometric error');
          return;
        }
        if (
          !this.isCurrentSocket(socket, generation) ||
          this.handshakeState !== 'signing-challenge'
        ) {
          return;
        }
        if (signature === null) {
          console.warn('[Mobily][Connection] Biometric authentication was cancelled');
          this.reconnectSuppressed = true;
          this.emitError('Biometric authentication cancelled', 'biometric-cancelled');
          this.setState('failed', 'biometric-cancelled');
          socket.close(1008, 'auth cancelled');
          return;
        }
        this.sendOn(socket, {
          type: 'auth-response',
          deviceId: this.opts.deviceBindingId,
          signature,
        });
        console.info('[Mobily][Connection] Device Key response sent');
        this.handshakeState = 'awaiting-auth-ok';
        break;
      }

      case 'output':
        if (this.handshakeState !== 'ready') {
          // The Station may send a human-readable diagnostic immediately
          // before closing a failed handshake. Never render it as terminal
          // state, but let the authoritative close code classify the failure.
          return;
        }
        this.opts.onOutput?.(frame.data, frame.latencyTags);
        break;

      case 'alert':
        if (this.handshakeState !== 'ready') {
          socket.close(WS_CLOSE_CODES.PROTOCOL_ERROR, 'alert before authentication');
          return;
        }
        this.opts.onAlert?.(frame.message);
        break;

      case 'session-status':
        if (this.handshakeState !== 'ready') {
          socket.close(WS_CLOSE_CODES.PROTOCOL_ERROR, 'session-status before authentication');
          return;
        }
        this.opts.onSessionStatus?.(frame.phase, frame.detail);
        break;

      case 'rpc':
        if ('method' in frame) {
          socket.close(WS_CLOSE_CODES.PROTOCOL_ERROR, 'unexpected RPC request');
        } else {
          this.opts.onRpcFrame?.(frame);
        }
        break;

      case 'rpc-stream':
        this.opts.onRpcFrame?.(frame);
        break;

      case 'auth-ok':
        if (this.handshakeState !== 'awaiting-auth-ok') {
          socket.close(WS_CLOSE_CODES.PROTOCOL_ERROR, 'unexpected auth acknowledgement');
          return;
        }
        this.handshakeState = 'awaiting-snapshot';
        console.info('[Mobily][Connection] Device Key accepted; awaiting Session Snapshot');
        break;

      case 'session-snapshot':
        if (this.handshakeState !== 'awaiting-snapshot' || !this.receivedInitialSize) {
          socket.close(WS_CLOSE_CODES.PROTOCOL_ERROR, 'unexpected Session Snapshot');
          return;
        }
        this.opts.onSnapshot?.(frame);
        this.handshakeState = 'ready';
        this.ready = true;
        this.retries = 0;
        this.backoff = INITIAL_BACKOFF_MS;
        this.setState('connected');
        console.info('[Mobily][Connection] Session Snapshot received; terminal connected');
        this.opts.onReady?.();
        break;

      case 'session-scrollback': {
        if (this.handshakeState !== 'ready' || !this.snapshotPaintAcknowledged) {
          socket.close(WS_CLOSE_CODES.PROTOCOL_ERROR, 'scrollback before Session Snapshot paint');
          return;
        }
        if (
          frame.transferId === this.completedScrollbackTransferId &&
          this.scrollbackTransfer === undefined
        ) {
          return;
        }
        const transfer =
          this.scrollbackTransfer ??
          (frame.sequence === 0
            ? {
                transferId: frame.transferId,
                nextSequence: 0,
                chunks: [],
                chars: 0,
              }
            : undefined);
        if (
          !transfer ||
          transfer.transferId !== frame.transferId ||
          transfer.nextSequence !== frame.sequence
        ) {
          socket.close(WS_CLOSE_CODES.PROTOCOL_ERROR, 'out-of-order Session scrollback');
          return;
        }
        const chars = transfer.chars + frame.data.length;
        if (chars > MAX_SESSION_SCROLLBACK_CHARS) {
          socket.close(WS_CLOSE_CODES.PROTOCOL_ERROR, 'Session scrollback exceeds size limit');
          return;
        }
        transfer.chunks.push(frame.data);
        transfer.chars = chars;
        transfer.nextSequence++;
        this.scrollbackTransfer = transfer;
        if (frame.done) {
          this.completedScrollbackTransferId = transfer.transferId;
          this.scrollbackTransfer = undefined;
          this.opts.onScrollback?.(transfer.chunks.join(''));
        }
        break;
      }

      case 'terminal-size-owner':
        if (this.handshakeState !== 'ready' && this.handshakeState !== 'awaiting-snapshot') {
          socket.close(WS_CLOSE_CODES.PROTOCOL_ERROR, 'ownership state before authentication');
          return;
        }
        this.opts.onTerminalSizeOwner?.({
          owner: frame.owner,
          ownedByRequester: frame.ownedByRequester,
        });
        break;

      case 'hello':
      case 'auth-response':
      case 'input':
      case 'session-snapshot-applied':
      case 'terminal-size-claim':
      case 'terminal-size-release':
        socket.close(WS_CLOSE_CODES.PROTOCOL_ERROR, 'unexpected server frame');
        break;
      case 'resize':
        if (this.handshakeState !== 'ready' && this.handshakeState !== 'awaiting-snapshot') {
          socket.close(WS_CLOSE_CODES.PROTOCOL_ERROR, 'resize before authentication');
          return;
        }
        if (this.handshakeState === 'awaiting-snapshot') {
          // The complete snapshot carries these dimensions. Publishing
          // handshake geometry would resize a retained reconnect frame before
          // its atomic replacement is available.
          this.receivedInitialSize = true;
          return;
        }
        this.opts.onResize?.(frame.cols, frame.rows);
        break;
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

  private send(frame: Frame): void {
    if (this.ws) this.sendOn(this.ws, frame);
  }

  private sendOn(socket: SocketLike, frame: Frame): void {
    if (socket.readyState === 1) socket.send(encodeFrame(frame));
  }

  private isCurrentSocket(socket: SocketLike, generation: number): boolean {
    return this.ws === socket && this.socketGeneration === generation;
  }

  private setState(state: ConnectionState, detail?: string): void {
    this.state = state;
    this.opts.onStateChange?.(state, detail);
  }

  private emitError(message: string, kind: ErrorKind = 'generic'): void {
    this.opts.onError?.(message, kind);
  }

  private resetScrollbackState(): void {
    this.snapshotPaintAcknowledged = false;
    this.scrollbackTransfer = undefined;
    this.completedScrollbackTransferId = undefined;
  }
}
