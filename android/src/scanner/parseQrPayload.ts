import { decodePairingPayload, type PairingPayload } from '@mobily/shared';

/** Parse and validate a versioned, expiring Station pairing payload. */
export function parseQrPayload(data: string): PairingPayload | null {
  try {
    return decodePairingPayload(data.trim());
  } catch {
    return null;
  }
}
