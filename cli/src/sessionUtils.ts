import type { RawData } from 'ws';

export function rawToUtf8(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
