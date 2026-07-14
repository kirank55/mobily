import { requireNativeModule } from 'expo-modules-core';

interface PinnedTransportModule {
  request(
    url: string,
    pin: string,
    method: string,
    body: string | null,
  ): Promise<{
    status: number;
    body: string;
  }>;
  openWebSocket(id: string, url: string, pin: string): boolean;
  sendWebSocket(id: string, data: string): boolean;
  closeWebSocket(id: string, code: number, reason: string): boolean;
  addListener(
    event: 'webSocketOpen' | 'webSocketMessage' | 'webSocketClosed' | 'webSocketFailure',
    listener: (event: Record<string, unknown>) => void,
  ): { remove(): void };
}

let cachedModule: PinnedTransportModule | null = null;
function nativeModule(): PinnedTransportModule {
  cachedModule ??= requireNativeModule<PinnedTransportModule>('MobilyPinnedTransport');
  return cachedModule;
}

export async function pinnedJsonRequest(
  url: string,
  pin: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }> {
  const result = await nativeModule().request(url, pin, 'POST', JSON.stringify(body));
  return {
    ok: result.status >= 200 && result.status < 300,
    status: result.status,
    json: async () => JSON.parse(result.body) as unknown,
  };
}

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
  private readonly subscriptions: { remove(): void }[];
  private static nextId = 1;

  constructor(url: string, pin: string) {
    const module = nativeModule();
    this.id = `pws-${Date.now()}-${PinnedWebSocket.nextId++}`;
    const forThis = (event: Record<string, unknown>) => event.id === this.id;
    this.subscriptions = [
      module.addListener('webSocketOpen', (event) => {
        if (!forThis(event)) return;
        this.readyState = PinnedWebSocket.OPEN;
        this.onopen?.();
      }),
      module.addListener('webSocketMessage', (event) => {
        if (forThis(event) && typeof event.data === 'string')
          this.onmessage?.({ data: event.data });
      }),
      module.addListener('webSocketClosed', (event) => {
        if (!forThis(event)) return;
        this.readyState = PinnedWebSocket.CLOSED;
        this.onclose?.({
          code: typeof event.code === 'number' ? event.code : 1006,
          reason: typeof event.reason === 'string' ? event.reason : '',
        });
        this.dispose();
      }),
      module.addListener('webSocketFailure', (event) => {
        if (!forThis(event)) return;
        this.readyState = PinnedWebSocket.CLOSED;
        this.onerror?.();
        this.onclose?.({ code: 1006, reason: 'TLS or network failure' });
        this.dispose();
      }),
    ];
    module.openWebSocket(this.id, url, pin);
  }

  send(data: string): void {
    if (!nativeModule().sendWebSocket(this.id, data)) throw new Error('WebSocket is not open');
  }

  close(code = 1000, reason = ''): void {
    this.readyState = PinnedWebSocket.CLOSING;
    nativeModule().closeWebSocket(this.id, code, reason);
  }

  private dispose(): void {
    for (const subscription of this.subscriptions) subscription.remove();
  }
}
