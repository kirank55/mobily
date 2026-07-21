/**
 * Browser transport for Expo web. Certificate pinning is not available;
 * use only with __DEV__ + allowInsecureTransport (plaintext local Station).
 */

export async function pinnedJsonRequest(
  url: string,
  _pin: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }> {
  console.warn(
    '[Mobily][Web] Ignoring certificate pin and using browser fetch (dev web only)',
  );
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    json: async () => JSON.parse(text) as unknown,
  };
}

/** WebSocket wrapper matching the native PinnedWebSocket surface. */
export class PinnedWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly id: string;
  readyState = PinnedWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  private readonly socket: WebSocket;
  private static nextId = 1;

  constructor(url: string, _pin: string) {
    console.warn(
      '[Mobily][Web] Ignoring certificate pin and using browser WebSocket (dev web only)',
    );
    this.id = `pws-web-${Date.now()}-${PinnedWebSocket.nextId++}`;
    this.socket = new WebSocket(url);
    this.socket.addEventListener('open', () => {
      this.readyState = PinnedWebSocket.OPEN;
      this.onopen?.();
    });
    this.socket.addEventListener('message', (event) => {
      this.onmessage?.({ data: event.data });
    });
    this.socket.addEventListener('close', (event) => {
      this.readyState = PinnedWebSocket.CLOSED;
      this.onclose?.({ code: event.code, reason: event.reason });
    });
    this.socket.addEventListener('error', () => {
      this.readyState = PinnedWebSocket.CLOSED;
      this.onerror?.();
    });
  }

  send(data: string): void {
    this.socket.send(data);
  }

  close(code = 1000, reason = ''): void {
    this.readyState = PinnedWebSocket.CLOSING;
    this.socket.close(code, reason);
  }
}
