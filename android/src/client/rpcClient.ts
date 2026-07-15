import type {
  JsonObject,
  JsonValue,
  RpcRequestFrame,
  RpcResponseFrame,
  RpcStreamFrame,
} from '@mobily/shared';

export class RpcClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RpcClientError';
  }
}

export interface RpcStreamResult {
  truncated: boolean;
  nextCursor?: string;
}

interface RpcClientOptions {
  timeoutMs?: number;
  idFactory?: () => string;
}

type Pending =
  | {
      kind: 'request';
      resolve: (value: JsonValue) => void;
      reject: (error: RpcClientError) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  | {
      kind: 'stream';
      resolve: (value: RpcStreamResult) => void;
      reject: (error: RpcClientError) => void;
      onChunk: (chunk: string) => void;
      timer: ReturnType<typeof setTimeout>;
    };

/** Correlates typed RPC work over an already-authenticated Station connection. */
export class RpcClient {
  private readonly timeoutMs: number;
  private readonly idFactory: () => string;
  private readonly pending = new Map<string, Pending>();
  private nextId = 0;

  constructor(
    private readonly send: (frame: RpcRequestFrame) => boolean,
    options: RpcClientOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.idFactory = options.idFactory ?? (() => `rpc-${Date.now()}-${++this.nextId}`);
  }

  request<T extends JsonValue = JsonValue>(method: string, params: JsonObject): Promise<T> {
    const id = this.uniqueId();
    return new Promise<T>((resolve, reject) => {
      const timer = this.timeout(id);
      this.pending.set(id, {
        kind: 'request',
        resolve: resolve as (value: JsonValue) => void,
        reject,
        timer,
      });
      if (!this.send({ type: 'rpc', id, method, params })) {
        this.reject(id, new RpcClientError('DISCONNECTED', 'Station is not connected'));
      }
    });
  }

  stream(
    method: string,
    params: JsonObject,
    onChunk: (chunk: string) => void,
  ): Promise<RpcStreamResult> {
    const id = this.uniqueId();
    return new Promise<RpcStreamResult>((resolve, reject) => {
      const timer = this.timeout(id);
      this.pending.set(id, { kind: 'stream', resolve, reject, onChunk, timer });
      if (!this.send({ type: 'rpc', id, method, params })) {
        this.reject(id, new RpcClientError('DISCONNECTED', 'Station is not connected'));
      }
    });
  }

  handleFrame(frame: RpcResponseFrame | RpcStreamFrame): void {
    const pending = this.pending.get(frame.id);
    if (!pending) return;
    if (frame.type === 'rpc') {
      if (pending.kind !== 'request') {
        this.reject(frame.id, new RpcClientError('PROTOCOL_ERROR', 'Unexpected RPC response'));
        return;
      }
      if ('error' in frame) {
        this.reject(frame.id, new RpcClientError(frame.error.code, frame.error.message));
      } else {
        clearTimeout(pending.timer);
        this.pending.delete(frame.id);
        pending.resolve(frame.result);
      }
      return;
    }

    if (pending.kind !== 'stream') {
      this.reject(frame.id, new RpcClientError('PROTOCOL_ERROR', 'Unexpected RPC stream'));
      return;
    }
    this.refreshTimeout(frame.id, pending);
    if (frame.chunk.length > 0) pending.onChunk(frame.chunk);
    if (!frame.done) return;
    if (frame.error) {
      this.reject(frame.id, new RpcClientError(frame.error.code, frame.error.message));
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(frame.id);
    pending.resolve({
      truncated: frame.truncated ?? false,
      ...(frame.nextCursor ? { nextCursor: frame.nextCursor } : {}),
    });
  }

  disconnect(): void {
    for (const id of [...this.pending.keys()]) {
      this.reject(id, new RpcClientError('DISCONNECTED', 'Station disconnected'));
    }
  }

  private uniqueId(): string {
    for (let attempt = 0; attempt < 10; attempt++) {
      const id = this.idFactory();
      if (!this.pending.has(id)) return id;
    }
    throw new RpcClientError('ID_EXHAUSTED', 'Could not allocate an RPC request id');
  }

  private timeout(id: string): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      this.reject(id, new RpcClientError('TIMEOUT', 'Station request timed out'));
    }, this.timeoutMs);
  }

  private refreshTimeout(id: string, pending: Pending): void {
    clearTimeout(pending.timer);
    pending.timer = this.timeout(id);
  }

  private reject(id: string, error: RpcClientError): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.reject(error);
  }
}
