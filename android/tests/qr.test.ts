import { encodePairingPayload, PROTOCOL_VERSION } from '@mobily/shared';
import { describe, expect, it } from 'vitest';

import { parseQrPayload } from '@/scanner/parseQrPayload';

describe('parseQrPayload()', () => {
  it('accepts a current, unexpired Station QR payload', () => {
    const encoded = encodePairingPayload({
      endpoint: 'wss://station.example.devtunnels.ms',
      code: 'ABCDEFG2',
      expiresAt: Date.now() + 60_000,
      protocolVersion: PROTOCOL_VERSION,
    });

    expect(parseQrPayload(`  ${encoded}\n`)).toMatchObject({
      endpoint: 'wss://station.example.devtunnels.ms',
      code: 'ABCDEFG2',
    });
  });

  it('rejects malformed and expired payloads', () => {
    const expired = encodePairingPayload({
      endpoint: 'wss://station.example.devtunnels.ms',
      code: 'ABCDEFG2',
      expiresAt: Date.now() - 1,
      protocolVersion: PROTOCOL_VERSION,
    });

    expect(parseQrPayload('not a pairing payload')).toBeNull();
    expect(parseQrPayload(expired)).toBeNull();
  });
});
