/**
 * cli/tests/auth.test.ts
 *
 * Unit tests for the AuthManager: pairing code generation/validation, device
 * binding, challenge-response signature verification, and code burning.
 *
 * Uses Node's `crypto` to generate a real EC keypair and sign a nonce — the
 * same algorithm `react-native-biometrics` uses on Android.
 */

import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@mobily/shared';
import { AuthManager } from '../src/auth.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATION = 'test-station';
const TUNNEL_URL = 'ws://192.168.1.10:4321';

/** Generate an EC keypair matching react-native-biometrics (P-256, SHA-256). */
function generateKeyPair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString('utf8'),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString('utf8'),
  };
}

/** Sign a nonce string with an EC private key (SHA-256, base64 output). */
function signNonce(privateKeyPem: string, nonce: string): string {
  const signature = sign('SHA256', Buffer.from(nonce), privateKeyPem);
  return signature.toString('base64');
}

function createAuth(): AuthManager {
  const auth = new AuthManager(STATION);
  auth.setTunnelUrl(TUNNEL_URL);
  return auth;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('AuthManager — pairing code', () => {
  it('generates an 8-character alphanumeric code', () => {
    const auth = createAuth();
    const code = auth.generatePairingCode();
    expect(code).toHaveLength(8);
    expect(code).toMatch(/^[A-Z0-9]+$/);
  });

  it('generates different codes on each call', () => {
    const auth = createAuth();
    const a = auth.generatePairingCode();
    const b = auth.generatePairingCode();
    expect(a).not.toBe(b);
  });

  it('exposes the current code via currentPairingCode', () => {
    const auth = createAuth();
    const code = auth.generatePairingCode();
    expect(auth.currentPairingCode).toBe(code);
  });

  it('returns null for currentPairingCode before generatePairingCode()', () => {
    const auth = createAuth();
    expect(auth.currentPairingCode).toBeNull();
  });
});

describe('AuthManager — pairing', () => {
  it('binds a device with a valid code and returns the connection payload', () => {
    const auth = createAuth();
    const code = auth.generatePairingCode();
    const { publicKeyPem } = generateKeyPair();

    const result = auth.pair(code, 'device-1', publicKeyPem);

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    if (result.ok) {
      expect(result.body).toEqual({
        tunnelUrl: TUNNEL_URL,
        stationName: STATION,
        protocolVersion: PROTOCOL_VERSION,
      });
    }
  });

  it('rejects pairing with an invalid code', () => {
    const auth = createAuth();
    auth.generatePairingCode();
    const { publicKeyPem } = generateKeyPair();

    const result = auth.pair('WRONG', 'device-1', publicKeyPem);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it('rejects pairing with missing fields', () => {
    const auth = createAuth();
    auth.generatePairingCode();

    const result = auth.pair('', '', '');

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  it('rejects pairing when no tunnel URL is set', () => {
    const auth = new AuthManager(STATION);
    auth.generatePairingCode();
    const { publicKeyPem } = generateKeyPair();

    const result = auth.pair(auth.currentPairingCode!, 'dev', publicKeyPem);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
  });

  it('burns the code after first successful bind', () => {
    const auth = createAuth();
    const code = auth.generatePairingCode();
    const { publicKeyPem } = generateKeyPair();

    auth.pair(code, 'device-1', publicKeyPem);

    expect(auth.currentPairingCode).toBeNull();

    const second = auth.pair(code, 'device-2', publicKeyPem);
    expect(second.ok).toBe(false);
    expect(second.status).toBe(403);
  });
});

describe('AuthManager — challenge-response', () => {
  it('verifies a valid signature', () => {
    const auth = createAuth();
    const code = auth.generatePairingCode();
    const { publicKeyPem, privateKeyPem } = generateKeyPair();
    auth.pair(code, 'device-1', publicKeyPem);

    const nonce = auth.createChallenge('device-1')!;
    expect(nonce).toBeTruthy();

    const signature = signNonce(privateKeyPem, nonce);
    expect(auth.verifyResponse('device-1', nonce, signature)).toBe(true);
  });

  it('rejects an invalid signature', () => {
    const auth = createAuth();
    const code = auth.generatePairingCode();
    const { publicKeyPem } = generateKeyPair();
    auth.pair(code, 'device-1', publicKeyPem);

    const nonce = auth.createChallenge('device-1')!;
    const fakeSignature = Buffer.from('not-a-real-signature').toString('base64');

    expect(auth.verifyResponse('device-1', nonce, fakeSignature)).toBe(false);
  });

  it('rejects a signature signed with a different key', () => {
    const auth = createAuth();
    const code = auth.generatePairingCode();
    const { publicKeyPem } = generateKeyPair();
    auth.pair(code, 'device-1', publicKeyPem);

    const nonce = auth.createChallenge('device-1')!;
    const { privateKeyPem: wrongKey } = generateKeyPair();
    const signature = signNonce(wrongKey, nonce);

    expect(auth.verifyResponse('device-1', nonce, signature)).toBe(false);
  });

  it('returns null for createChallenge on an unbound device', () => {
    const auth = createAuth();
    expect(auth.createChallenge('unknown')).toBeNull();
  });

  it('rejects verifyResponse for an unbound device', () => {
    const auth = createAuth();
    expect(auth.verifyResponse('unknown', 'nonce', 'sig')).toBe(false);
  });

  it('isDeviceBound returns true for paired devices', () => {
    const auth = createAuth();
    const code = auth.generatePairingCode();
    const { publicKeyPem } = generateKeyPair();

    expect(auth.isDeviceBound('device-1')).toBe(false);
    auth.pair(code, 'device-1', publicKeyPem);
    expect(auth.isDeviceBound('device-1')).toBe(true);
  });

  it('each challenge produces a unique nonce', () => {
    const auth = createAuth();
    const code = auth.generatePairingCode();
    const { publicKeyPem } = generateKeyPair();
    auth.pair(code, 'device-1', publicKeyPem);

    const n1 = auth.createChallenge('device-1');
    const n2 = auth.createChallenge('device-1');
    expect(n1).not.toBe(n2);
  });
});
