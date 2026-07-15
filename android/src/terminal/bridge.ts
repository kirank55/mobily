export type TerminalBridgeMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'input'; readonly data: string; readonly latencyTag: string }
  | { readonly type: 'resize'; readonly cols: number; readonly rows: number }
  | {
      readonly type: 'latency-stats';
      readonly n: number;
      readonly p50: number;
      readonly p95: number;
    };

export function parseTerminalBridgeMessage(raw: string): TerminalBridgeMessage | null {
  if (raw.length > 70_000) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  switch (message['type']) {
    case 'ready':
      return { type: 'ready' };
    case 'input':
      return typeof message['data'] === 'string' &&
        message['data'].length <= 32_768 &&
        typeof message['latencyTag'] === 'string' &&
        /^[A-Za-z0-9_-]{1,64}$/.test(message['latencyTag'])
        ? { type: 'input', data: message['data'], latencyTag: message['latencyTag'] }
        : null;
    case 'resize':
      return isDimension(message['cols']) && isDimension(message['rows'])
        ? { type: 'resize', cols: message['cols'], rows: message['rows'] }
        : null;
    case 'latency-stats':
      return isNonNegativeNumber(message['n']) &&
        isNonNegativeNumber(message['p50']) &&
        isNonNegativeNumber(message['p95'])
        ? {
            type: 'latency-stats',
            n: message['n'],
            p50: message['p50'],
            p95: message['p95'],
          }
        : null;
    default:
      return null;
  }
}

function isDimension(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0 && (value as number) <= 1000;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
