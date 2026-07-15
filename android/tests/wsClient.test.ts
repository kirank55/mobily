import { decodeFrame, encodeFrame, PROTOCOL_VERSION, WS_CLOSE_CODES } from '@mobily/shared';
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
  const client = new WsClient({
    url: 'wss://station.example.devtunnels.ms',
    deviceBindingId: 'binding_AAAAAAAAAAAAAAAAAAAAAA',
    protocolVersion: PROTOCOL_VERSION,
    onStateChange: (state) => states.push(state),
    onError: (_message, kind) => errors.push(kind ?? 'generic'),
    onOutput: (data, tags) => outputs.push({ data, tags }),
  });
  return { client, states, errors, outputs };
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  deviceKey.signNonce.mockResolvedValue('signed-challenge');
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

describe('WsClient', () => {
  it('completes version negotiation and Device Key authentication before terminal I/O', async () => {
    const { client, states, outputs } = createClient();
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
    socket.receive({ type: 'output', data: 'ready', latencyTags: ['lat-12345678'] });

    expect(states.at(-1)).toBe('connected');
    expect(outputs).toEqual([{ data: 'ready', tags: ['lat-12345678'] }]);
  });

  it('maps permanent close codes to user-facing failures without reconnecting', () => {
    const { client, states, errors } = createClient();
    client.connect();
    FakeWebSocket.instances[0]!.close(WS_CLOSE_CODES.AUTH_REJECTED, 'rejected');

    expect(states.at(-1)).toBe('failed');
    expect(errors).toEqual(['auth-rejection']);
    expect(FakeWebSocket.instances).toHaveLength(1);
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
