import {
  decodeFrame,
  encodeFrame,
  PROTOCOL_VERSION,
  WS_CLOSE_CODES,
  type SessionSnapshotFrame,
} from '@mobily/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const deviceKey = vi.hoisted(() => ({ signNonce: vi.fn() }));
vi.mock('@/auth/deviceKey', () => deviceKey);

import { WsClient, type ConnectionState, type ErrorKind } from '@/client/wsClient';

class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];

  readonly sent: string[] = [];
  readyState = FakeWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  open(): void {
    this.onopen?.();
  }

  receive(frame: Parameters<typeof encodeFrame>[0]): void {
    this.onmessage?.({ data: encodeFrame(frame) });
  }
}

function createClient() {
  const states: ConnectionState[] = [];
  const errors: ErrorKind[] = [];
  const outputs: Array<{ data: string; tags?: readonly string[] }> = [];
  const alerts: string[] = [];
  const resizes: Array<[number, number]> = [];
  const snapshots: SessionSnapshotFrame[] = [];
  const client = new WsClient({
    url: 'wss://station.example.devtunnels.ms',
    deviceBindingId: 'binding_AAAAAAAAAAAAAAAAAAAAAA',
    protocolVersion: PROTOCOL_VERSION,
    onStateChange: (state) => states.push(state),
    onError: (_message, kind) => errors.push(kind ?? 'generic'),
    onOutput: (data, tags) => outputs.push({ data, tags }),
    onAlert: (message) => alerts.push(message),
    onResize: (cols, rows) => resizes.push([cols, rows]),
    onSnapshot: (snapshot) => snapshots.push(snapshot),
  });
  return { client, states, errors, outputs, alerts, resizes, snapshots };
}

function snapshot(chars = 'ready'): SessionSnapshotFrame {
  return {
    type: 'session-snapshot',
    cols: chars.length,
    rows: 1,
    activeScreen: 'normal',
    cursor: { col: chars.length, row: 0, visible: true, style: 'block', blink: true },
    grid: [Array.from(chars, (char) => ({ chars: char, width: 1 as const }))],
  };
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  deviceKey.signNonce.mockResolvedValue('signed-challenge');
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

describe('WsClient', () => {
  it('completes version negotiation and Device Key authentication before terminal I/O', async () => {
    const { client, states, outputs, resizes, snapshots } = createClient();
    client.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    expect(decodeFrame(socket.sent[0]!)).toEqual({
      type: 'hello',
      protocolVersion: PROTOCOL_VERSION,
    });

    socket.receive({ type: 'hello-ack', protocolVersion: PROTOCOL_VERSION });
    socket.receive({ type: 'auth-challenge', nonce: 'challenge' });
    await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
    expect(decodeFrame(socket.sent[1]!)).toEqual({
      type: 'auth-response',
      deviceId: 'binding_AAAAAAAAAAAAAAAAAAAAAA',
      signature: 'signed-challenge',
    });

    socket.receive({ type: 'auth-ok' });
    expect(states.at(-1)).toBe('connecting');
    socket.receive({ type: 'resize', cols: 160, rows: 48 });
    socket.receive(snapshot());
    socket.receive({ type: 'output', data: 'ready', latencyTags: ['lat-12345678'] });

    expect(states.at(-1)).toBe('connected');
    expect(snapshots).toEqual([snapshot()]);
    expect(outputs).toEqual([{ data: 'ready', tags: ['lat-12345678'] }]);
    expect(resizes).toEqual([[160, 48]]);
    expect(socket.readyState).toBe(FakeWebSocket.OPEN);
  });

  it('rejects snapshots before authentication, after first paint, or above the frame limit', async () => {
    const beforeAuth = createClient();
    beforeAuth.client.connect();
    const unauthenticatedSocket = FakeWebSocket.instances[0]!;
    unauthenticatedSocket.open();
    unauthenticatedSocket.receive(snapshot());
    expect(unauthenticatedSocket.readyState).toBe(3);

    const authenticated = createClient();
    authenticated.client.connect();
    const socket = FakeWebSocket.instances[1]!;
    socket.open();
    socket.receive({ type: 'hello-ack', protocolVersion: PROTOCOL_VERSION });
    socket.receive({ type: 'auth-challenge', nonce: 'challenge' });
    await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
    socket.receive({ type: 'auth-ok' });
    socket.receive({ type: 'resize', cols: 5, rows: 1 });
    socket.receive(snapshot());
    socket.receive(snapshot());
    expect(socket.readyState).toBe(3);

    const oversized = createClient();
    oversized.client.connect();
    const oversizedSocket = FakeWebSocket.instances[2]!;
    oversizedSocket.open();
    oversizedSocket.onmessage?.({ data: ' '.repeat(2 * 1024 * 1024 + 1) });
    expect(oversizedSocket.readyState).toBe(3);
  });

  it('distinguishes a Device Key signing failure from biometric cancellation', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const nativeError = new Error('Device Key was permanently invalidated');
    deviceKey.signNonce.mockRejectedValue(nativeError);
    const { client, states, errors } = createClient();
    client.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.receive({ type: 'hello-ack', protocolVersion: PROTOCOL_VERSION });
    socket.receive({ type: 'auth-challenge', nonce: 'challenge' });

    await vi.waitFor(() => expect(states.at(-1)).toBe('failed'));
    expect(errors).toEqual(['device-key-error']);
    expect(socket.sent).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalledWith(
      '[Mobily][Connection] Device Key signing failed',
      nativeError,
    );
  });

  it('reports an explicitly cancelled biometric prompt as cancellation', async () => {
    deviceKey.signNonce.mockResolvedValue(null);
    const { client, states, errors } = createClient();
    client.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.receive({ type: 'hello-ack', protocolVersion: PROTOCOL_VERSION });
    socket.receive({ type: 'auth-challenge', nonce: 'challenge' });

    await vi.waitFor(() => expect(states.at(-1)).toBe('failed'));
    expect(errors).toEqual(['biometric-cancelled']);
  });

  it('allows retry after a transient biometric failure', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    deviceKey.signNonce.mockRejectedValue(
      Object.assign(new Error('Biometric sensor is temporarily unavailable'), {
        code: 'ERR_BIOMETRIC_AUTHENTICATION',
      }),
    );
    const { client, states, errors } = createClient();
    client.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.receive({ type: 'hello-ack', protocolVersion: PROTOCOL_VERSION });
    socket.receive({ type: 'auth-challenge', nonce: 'challenge' });

    await vi.waitFor(() => expect(states.at(-1)).toBe('failed'));
    expect(errors).toEqual(['biometric-error']);
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it('maps permanent close codes to user-facing failures without reconnecting', () => {
    const { client, states, errors } = createClient();
    client.connect();
    FakeWebSocket.instances[0]!.close(WS_CLOSE_CODES.AUTH_REJECTED, 'rejected');

    expect(states.at(-1)).toBe('failed');
    expect(errors).toEqual(['auth-rejection']);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('delivers authenticated terminal alerts to the app', async () => {
    const { client, alerts } = createClient();
    client.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.receive({ type: 'hello-ack', protocolVersion: PROTOCOL_VERSION });
    socket.receive({ type: 'auth-challenge', nonce: 'challenge' });
    await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
    socket.receive({ type: 'auth-ok' });
    socket.receive({ type: 'resize', cols: 5, rows: 1 });
    socket.receive(snapshot());

    socket.receive({ type: 'alert', message: 'Approve the deployment?' });

    expect(alerts).toEqual(['Approve the deployment?']);
  });

  it('rejects terminal alerts before authentication completes', () => {
    const { client, alerts } = createClient();
    client.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();

    socket.receive({ type: 'alert', message: 'Untrusted prompt' });

    expect(alerts).toEqual([]);
    expect(socket.readyState).toBe(3);
  });

  it('reconnects transient failures with exponential backoff', async () => {
    vi.useFakeTimers();
    try {
      const { client, states } = createClient();
      client.connect();
      FakeWebSocket.instances[0]!.close(1006, 'offline');
      expect(states.at(-1)).toBe('reconnecting');

      await vi.advanceTimersByTimeAsync(999);
      expect(FakeWebSocket.instances).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeWebSocket.instances).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects plaintext Station transport before opening a socket', () => {
    const errors: ErrorKind[] = [];
    const client = new WsClient({
      url: 'ws://station.local:1234',
      deviceBindingId: 'binding_AAAAAAAAAAAAAAAAAAAAAA',
      protocolVersion: PROTOCOL_VERSION,
      onError: (_message, kind) => errors.push(kind ?? 'generic'),
    });

    client.connect();

    expect(errors).toEqual(['generic']);
    expect(FakeWebSocket.instances).toEqual([]);
  });
});
