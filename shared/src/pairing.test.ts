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
      'mobily://pair?v=2&endpoint=wss%3A%2F%2Fstation.example.test%2Fterminal&code=ABCD2345&expires=1900000000000&protocol=1',
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
      'mobily://pair?v=2&endpoint=https%3A%2F%2Fexample.test&code=ABCD2345&expires=1900000000000&protocol=1';
    expect(() => decodePairingPayload(encoded, 0)).toThrow('WebSocket');
  });

  it('round-trips a valid local certificate pin and rejects malformed pins', () => {
    const pinned = {
      ...payload,
      certificatePin: 'sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    };
    expect(decodePairingPayload(encodePairingPayload(pinned), 0)).toEqual(pinned);
    expect(() => encodePairingPayload({ ...payload, certificatePin: 'sha256/bad' })).toThrow(
      'certificate pin',
    );
  });

  it('round-trips a station fingerprint and rejects malformed fingerprints', () => {
    const identified = { ...payload, stationFingerprint: 'SHA256:1A2B-3C4D-5E6F-7A8B' };

    expect(decodePairingPayload(encodePairingPayload(identified), 0)).toEqual(identified);
    expect(() => encodePairingPayload({ ...payload, stationFingerprint: 'SHA256:nope' })).toThrow(
      'station fingerprint',
    );

    const malformed =
      'mobily://pair?v=2&endpoint=wss%3A%2F%2Fstation.example.test%2Fterminal&code=ABCD2345&expires=1900000000000&protocol=1&fid=SHA256%3Anope';
    expect(() => decodePairingPayload(malformed, 0)).toThrow('station fingerprint');
  });
});

describe('pairing proof payload', () => {
  it('is domain-separated and deterministic', () => {
    expect(
      createPairingProofPayload('ABCD2345', 'device-1', 'PUBLIC KEY', 'wss://station.example.test'),
    ).toBe('mobily-pair-v2\nwss://station.example.test\n\nABCD2345\ndevice-1\nPUBLIC KEY');
  });

  it('binds a local certificate pin into the proof', () => {
    expect(
      createPairingProofPayload(
        'ABCD2345',
        'device-1',
        'PUBLIC KEY',
        'wss://192.168.1.2:1234',
        'sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      ),
    ).toContain('wss://192.168.1.2:1234\nsha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
  });
});
