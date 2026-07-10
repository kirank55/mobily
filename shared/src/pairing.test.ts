import { describe, expect, it } from 'vitest';
import {
  createPairingProofPayload,
  decodePairingPayload,
  encodePairingPayload,
} from './pairing.js';

describe('pairing QR payload', () => {
  const payload = {
    endpoint: 'wss://station.example.test/terminal',
    code: 'ABCD2345',
    expiresAt: 1_900_000_000_000,
    protocolVersion: 1,
  } as const;

  it('round-trips a versioned Station endpoint and expiring code', () => {
    const encoded = encodePairingPayload(payload);

    expect(encoded).toBe(
      'mobily://pair?v=1&endpoint=wss%3A%2F%2Fstation.example.test%2Fterminal&code=ABCD2345&expires=1900000000000&protocol=1',
    );
    expect(decodePairingPayload(encoded, 1_800_000_000_000)).toEqual(payload);
  });

  it('rejects expired and malformed payloads', () => {
    expect(() => decodePairingPayload(encodePairingPayload(payload), payload.expiresAt)).toThrow(
      'expired',
    );
    expect(() => decodePairingPayload('https://example.test', 0)).toThrow('mobily pairing QR');
  });

  it('rejects endpoints that are not WebSocket URLs', () => {
    const encoded =
      'mobily://pair?v=1&endpoint=https%3A%2F%2Fexample.test&code=ABCD2345&expires=1900000000000&protocol=1';
    expect(() => decodePairingPayload(encoded, 0)).toThrow('WebSocket');
  });
});

describe('pairing proof payload', () => {
  it('is domain-separated and deterministic', () => {
    expect(
      createPairingProofPayload('ABCD2345', 'device-1', 'PUBLIC KEY', 'wss://station.example.test'),
    ).toBe('mobily-pair-v1\nwss://station.example.test\nABCD2345\ndevice-1\nPUBLIC KEY');
  });
});
