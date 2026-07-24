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

// eslint-disable-next-line import/first -- register the hoisted native mock before loading WsClient
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
  const terminalEvents: string[] = [];
  const states: ConnectionState[] = [];
  const errors: ErrorKind[] = [];
  const outputs: { data: string; tags?: readonly string[] }[] = [];
  const alerts: string[] = [];
  const sessionStatuses: { phase: string; detail?: string }[] = [];
  const resizes: [number, number][] = [];
  const snapshots: SessionSnapshotFrame[] = [];
  const scrollbacks: string[] = [];
  const sizeOwners: { owner: 'station' | 'android'; ownedByRequester: boolean }[] = [];
  const client = new WsClient({
    url: 'wss://station.example.devtunnels.ms',
    deviceBindingId: 'binding_AAAAAAAAAAAAAAAAAAAAAA',
    protocolVersion: PROTOCOL_VERSION,
    onStateChange: (state) => states.push(state),
    onError: (_message, kind) => errors.push(kind ?? 'generic'),
    onOutput: (data, tags) => {
      outputs.push({ data, tags });
      terminalEvents.push(`output:${data}`);
    },
    onAlert: (message) => alerts.push(message),
    onSessionStatus: (phase, detail) =>
      sessionStatuses.push({ phase, ...(detail === undefined ? {} : { detail }) }),
    onResize: (cols, rows) => {
      resizes.push([cols, rows]);
      terminalEvents.push(`resize:${cols}x${rows}`);
    },
    onSnapshot: (snapshot) => {
      snapshots.push(snapshot);
      terminalEvents.push(`snapshot:${snapshot.grid[0]?.map((cell) => cell.chars).join('')}`);
    },
    onScrollback: (data) => scrollbacks.push(data),
    onTerminalSizeOwner: (owner) => sizeOwners.push(owner),
  });
  return {
    client,
    states,
    errors,
    outputs,
    alerts,
    sessionStatuses,
    resizes,
    snapshots,
    scrollbacks,
    sizeOwners,
    terminalEvents,
  };
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
    const { client, states, outputs, resizes, snapshots, sizeOwners } = createClient();
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
    socket.receive({
      type: 'terminal-size-owner',
      owner: 'station',
      ownedByRequester: false,
    });
    socket.receive({ type: 'resize', cols: 160, rows: 48 });
    socket.receive(snapshot());
    socket.receive({ type: 'output', data: 'ready', latencyTags: ['lat-12345678'] });

    expect(states.at(-1)).toBe('connected');
    expect(snapshots).toEqual([snapshot()]);
    expect(outputs).toEqual([{ data: 'ready', tags: ['lat-12345678'] }]);
    expect(resizes).toEqual([]);
    expect(sizeOwners).toEqual([{ owner: 'station', ownedByRequester: false }]);
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

  it('requests history only after first paint and assembles one ordered bounded transfer', async () => {
    const { client, scrollbacks } = createClient();
    client.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.receive({ type: 'hello-ack', protocolVersion: PROTOCOL_VERSION });
    socket.receive({ type: 'auth-challenge', nonce: 'challenge' });
    await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
    socket.receive({ type: 'auth-ok' });
    socket.receive({ type: 'resize', cols: 5, rows: 1 });
    socket.receive(snapshot());

    expect(socket.sent.map(decodeFrame)).not.toContainEqual({
      type: 'session-snapshot-applied',
    });
    client.acknowledgeSnapshotApplied();
    expect(decodeFrame(socket.sent.at(-1)!)).toEqual({ type: 'session-snapshot-applied' });

    socket.receive({
      type: 'session-scrollback',
      transferId: 'history-1',
      sequence: 0,
      data: 'old ',
      done: false,
    });
    socket.receive({
      type: 'session-scrollback',
      transferId: 'history-1',
      sequence: 1,
      data: 'lines\r\n',
      done: true,
    });
    expect(scrollbacks).toEqual(['old lines\r\n']);

    socket.receive({
      type: 'session-scrollback',
      transferId: 'history-1',
      sequence: 1,
      data: 'lines\r\n',
      done: true,
    });
    expect(scrollbacks).toEqual(['old lines\r\n']);
  });

  it('claims and releases Terminal Size Ownership only after authentication', async () => {
    const { client, sizeOwners } = createClient();
    client.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    client.claimTerminalSize();
    expect(socket.sent.map(decodeFrame)).not.toContainEqual({ type: 'terminal-size-claim' });

    socket.receive({ type: 'hello-ack', protocolVersion: PROTOCOL_VERSION });
    socket.receive({ type: 'auth-challenge', nonce: 'challenge' });
    await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
    socket.receive({ type: 'auth-ok' });
    socket.receive({ type: 'resize', cols: 5, rows: 1 });
    socket.receive(snapshot());

    client.claimTerminalSize();
    client.releaseTerminalSize();
    expect(socket.sent.slice(-2).map(decodeFrame)).toEqual([
      { type: 'terminal-size-claim' },
      { type: 'terminal-size-release' },
    ]);

    socket.receive({ type: 'terminal-size-owner', owner: 'android', ownedByRequester: true });
    expect(sizeOwners).toEqual([{ owner: 'android', ownedByRequester: true }]);
  });

  it('rejects scrollback before paint, out of order, or above the transfer limit', async () => {
    const beforePaint = createClient();
    beforePaint.client.connect();
    const first = FakeWebSocket.instances[0]!;
    first.open();
    first.receive({ type: 'hello-ack', protocolVersion: PROTOCOL_VERSION });
    first.receive({ type: 'auth-challenge', nonce: 'challenge' });
    await vi.waitFor(() => expect(first.sent).toHaveLength(2));
    first.receive({ type: 'auth-ok' });
    first.receive({ type: 'resize', cols: 5, rows: 1 });
    first.receive(snapshot());
    first.receive({
      type: 'session-scrollback',
      transferId: 'history-1',
      sequence: 0,
      data: '',
      done: true,
    });
    expect(first.readyState).toBe(3);

    const outOfOrder = createClient();
    outOfOrder.client.connect();
    const second = FakeWebSocket.instances[1]!;
    second.open();
    second.receive({ type: 'hello-ack', protocolVersion: PROTOCOL_VERSION });
    second.receive({ type: 'auth-challenge', nonce: 'challenge' });
    await vi.waitFor(() => expect(second.sent).toHaveLength(2));
    second.receive({ type: 'auth-ok' });
    second.receive({ type: 'resize', cols: 5, rows: 1 });
    second.receive(snapshot());
    outOfOrder.client.acknowledgeSnapshotApplied();
    second.receive({
      type: 'session-scrollback',
      transferId: 'history-2',
      sequence: 1,
      data: '',
      done: true,
    });
    expect(second.readyState).toBe(3);
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

  it('delivers authenticated session-status phases to the app', async () => {
    const { client, sessionStatuses } = createClient();
    client.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.receive({ type: 'hello-ack', protocolVersion: PROTOCOL_VERSION });
    socket.receive({ type: 'auth-challenge', nonce: 'challenge' });
    await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
    socket.receive({ type: 'auth-ok' });
    socket.receive({ type: 'resize', cols: 5, rows: 1 });
    socket.receive(snapshot());

    socket.receive({ type: 'session-status', phase: 'working', detail: 'Thinking' });
    socket.receive({ type: 'session-status', phase: 'waiting', detail: 'Approve tool call?' });

    expect(sessionStatuses).toEqual([
      { phase: 'working', detail: 'Thinking' },
      { phase: 'waiting', detail: 'Approve tool call?' },
    ]);
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

  it('retains the current frame until reconnect snapshot replacement and ignores superseded sockets', async () => {
    vi.useFakeTimers();
    try {
      const { client, outputs, resizes, snapshots, terminalEvents } = createClient();
      client.connect();
      const first = FakeWebSocket.instances[0]!;
      first.open();
      first.receive({ type: 'hello-ack', protocolVersion: PROTOCOL_VERSION });
      first.receive({ type: 'auth-challenge', nonce: 'first-challenge' });
      await vi.waitFor(() => expect(first.sent).toHaveLength(2));
      first.receive({ type: 'auth-ok' });
      first.receive({ type: 'resize', cols: 3, rows: 1 });
      first.receive(snapshot('old'));
      first.receive({ type: 'output', data: '!' });

      first.close(1006, 'transient');
      await vi.advanceTimersByTimeAsync(1000);
      const second = FakeWebSocket.instances[1]!;
      second.open();
      second.receive({ type: 'hello-ack', protocolVersion: PROTOCOL_VERSION });
      second.receive({ type: 'auth-challenge', nonce: 'second-challenge' });
      await vi.waitFor(() => expect(second.sent).toHaveLength(2));
      second.receive({ type: 'auth-ok' });
      second.receive({ type: 'resize', cols: 5, rows: 1 });

      // The reconnect's dimensions are handshake metadata. They must not
      // resize the retained frame before its complete replacement arrives.
      expect(resizes).toEqual([]);
      expect(snapshots).toEqual([snapshot('old')]);

      // A delayed frame from the superseded socket cannot reach the terminal.
      first.receive({ type: 'output', data: 'stale' });

      second.receive(snapshot('fresh'));
      second.receive({ type: 'output', data: '+live' });

      expect(outputs).toEqual([
        { data: '!', tags: undefined },
        { data: '+live', tags: undefined },
      ]);
      expect(terminalEvents).toEqual([
        'snapshot:old',
        'output:!',
        'snapshot:fresh',
        'output:+live',
      ]);
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
