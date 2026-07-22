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
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPairingProofPayload, PROTOCOL_VERSION } from '@mobily/shared';
import { AuthManager } from '../src/auth.js';
import { MemoryBindingRepository } from '../src/bindings.js';

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

function pairDevice(
  auth: AuthManager,
  code: string,
  deviceId: string,
  publicKeyPem: string,
  privateKeyPem: string,
) {
  const proof = signNonce(
    privateKeyPem,
    createPairingProofPayload(code, deviceId, publicKeyPem, TUNNEL_URL),
  );
  return auth.pair(code, deviceId, publicKeyPem, proof);
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

describe('BindingRepository — administration', () => {
  it('loads bindings from storage and revokes them explicitly', () => {
    const repository = new MemoryBindingRepository();
    const auth = new AuthManager(STATION, repository);
    auth.setTunnelUrl(TUNNEL_URL);
    const code = auth.generatePairingCode();
    const { publicKeyPem, privateKeyPem } = generateKeyPair();
    pairDevice(auth, code, 'device-1', publicKeyPem, privateKeyPem);

    expect(repository.list()).toHaveLength(1);
    expect(repository.revoke('device-1')).toBe(true);
    expect(repository.get('device-1')).toBeUndefined();
    expect(new AuthManager(STATION, repository).isDeviceBound('device-1')).toBe(false);
  });
});

describe('AuthManager — pairing', () => {
  it('binds a device with a valid code and returns the connection payload', () => {
    const auth = createAuth();
    const code = auth.generatePairingCode();
    const { publicKeyPem, privateKeyPem } = generateKeyPair();

    const result = pairDevice(auth, code, 'device-1', publicKeyPem, privateKeyPem);

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
    const { publicKeyPem, privateKeyPem } = generateKeyPair();

    const result = pairDevice(auth, 'WRONG', 'device-1', publicKeyPem, privateKeyPem);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it('rejects non-ASCII strings whose low bytes match the pairing code', () => {
    const auth = createAuth();
    const code = auth.generatePairingCode();
    const lowByteAlias = [...code]
      .map((character) => String.fromCharCode(character.charCodeAt(0) + 256))
      .join('');
    const { publicKeyPem, privateKeyPem } = generateKeyPair();

    const result = pairDevice(auth, lowByteAlias, 'device-1', publicKeyPem, privateKeyPem);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(auth.currentPairingCode).toBe(code);
  });

  it('rejects pairing with missing fields', () => {
    const auth = createAuth();
    auth.generatePairingCode();

    const result = auth.pair('', '', '', '');

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  it('rejects pairing when no tunnel URL is set', () => {
    const auth = new AuthManager(STATION);
    auth.generatePairingCode();
    const { publicKeyPem, privateKeyPem } = generateKeyPair();

    const result = pairDevice(auth, auth.currentPairingCode!, 'dev', publicKeyPem, privateKeyPem);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
  });

  it('burns the code after first successful bind', () => {
    const auth = createAuth();
    const code = auth.generatePairingCode();
    const { publicKeyPem, privateKeyPem } = generateKeyPair();

    pairDevice(auth, code, 'device-1', publicKeyPem, privateKeyPem);

    expect(auth.currentPairingCode).toBeNull();

    const second = pairDevice(auth, code, 'device-2', publicKeyPem, privateKeyPem);
    expect(second.ok).toBe(false);
    expect(second.status).toBe(403);
  });

  it('rejects malformed key material without burning the code', () => {
    const auth = createAuth();
    const code = auth.generatePairingCode();

    const result = auth.pair(code, 'device-1', 'not-a-public-key', 'not-a-proof');

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(auth.currentPairingCode).toBe(code);
  });

  it('requires proof that the device holds the submitted private key', () => {
    const auth = createAuth();
    const code = auth.generatePairingCode();
    const { publicKeyPem } = generateKeyPair();

    const result = auth.pair(code, 'device-1', publicKeyPem, 'invalid-proof');

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(auth.currentPairingCode).toBe(code);
  });
});

describe('AuthManager — challenge-response', () => {
  it('verifies a valid signature', () => {
    const auth = createAuth();
    const code = auth.generatePairingCode();
    const { publicKeyPem, privateKeyPem } = generateKeyPair();
    pairDevice(auth, code, 'device-1', publicKeyPem, privateKeyPem);

    const nonce = auth.createChallenge();
    expect(nonce).toBeTruthy();

    const signature = signNonce(privateKeyPem, nonce);
    expect(auth.verifyResponse('device-1', nonce, signature)).toBe(true);
  });

  it('rejects an invalid signature', () => {
    const auth = createAuth();
    const code = auth.generatePairingCode();
    const { publicKeyPem, privateKeyPem } = generateKeyPair();
    pairDevice(auth, code, 'device-1', publicKeyPem, privateKeyPem);

    const nonce = auth.createChallenge();
    const fakeSignature = Buffer.from('not-a-real-signature').toString('base64');

    expect(auth.verifyResponse('device-1', nonce, fakeSignature)).toBe(false);
  });

  it('rejects a signature signed with a different key', () => {
    const auth = createAuth();
    const code = auth.generatePairingCode();
    const { publicKeyPem, privateKeyPem } = generateKeyPair();
    pairDevice(auth, code, 'device-1', publicKeyPem, privateKeyPem);

    const nonce = auth.createChallenge();
    const { privateKeyPem: wrongKey } = generateKeyPair();
    const signature = signNonce(wrongKey, nonce);

    expect(auth.verifyResponse('device-1', nonce, signature)).toBe(false);
  });

  it('rejects verifyResponse for an unbound device', () => {
    const auth = createAuth();
    const nonce = auth.createChallenge();
    expect(auth.verifyResponse('unknown', nonce, 'sig')).toBe(false);
  });

  it('isDeviceBound returns true for paired devices', () => {
    const auth = createAuth();
    const code = auth.generatePairingCode();
    const { publicKeyPem, privateKeyPem } = generateKeyPair();

    expect(auth.isDeviceBound('device-1')).toBe(false);
    pairDevice(auth, code, 'device-1', publicKeyPem, privateKeyPem);
    expect(auth.isDeviceBound('device-1')).toBe(true);
  });

  it('each challenge produces a unique nonce', () => {
    const auth = createAuth();

    const n1 = auth.createChallenge();
    const n2 = auth.createChallenge();
    expect(n1).not.toBe(n2);
  });
});

describe('AuthManager — lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('expires the pairing code after the TTL', () => {
    vi.useFakeTimers();
    const auth = createAuth();
    const code = auth.generatePairingCode();

    expect(auth.currentPairingCode).toBe(code);

    // Advance past the 10-minute TTL.
    vi.advanceTimersByTime(11 * 60 * 1000);

    expect(auth.currentPairingCode).toBeNull();

    const { publicKeyPem, privateKeyPem } = generateKeyPair();
    const result = pairDevice(auth, code, 'device-1', publicKeyPem, privateKeyPem);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it('replaces the old code when a new one is generated', () => {
    const auth = createAuth();
    const code1 = auth.generatePairingCode();
    const code2 = auth.generatePairingCode();

    expect(code1).not.toBe(code2);
    expect(auth.currentPairingCode).toBe(code2);

    const { publicKeyPem, privateKeyPem } = generateKeyPair();
    const result = pairDevice(auth, code1, 'device-1', publicKeyPem, privateKeyPem);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it('can pair multiple devices with separate codes', () => {
    const auth = createAuth();

    const code1 = auth.generatePairingCode();
    const { publicKeyPem: pub1, privateKeyPem: priv1 } = generateKeyPair();
    const r1 = pairDevice(auth, code1, 'device-A', pub1, priv1);
    expect(r1.ok).toBe(true);

    const code2 = auth.generatePairingCode();
    const { publicKeyPem: pub2, privateKeyPem: priv2 } = generateKeyPair();
    const r2 = pairDevice(auth, code2, 'device-B', pub2, priv2);
    expect(r2.ok).toBe(true);

    // Both devices can authenticate.
    const nonce1 = auth.createChallenge();
    expect(auth.verifyResponse('device-A', nonce1, signNonce(priv1, nonce1))).toBe(true);

    const nonce2 = auth.createChallenge();
    expect(auth.verifyResponse('device-B', nonce2, signNonce(priv2, nonce2))).toBe(true);
  });

  it('supports multiple challenge-response cycles for the same device', () => {
    const auth = createAuth();
    const code = auth.generatePairingCode();
    const { publicKeyPem, privateKeyPem } = generateKeyPair();
    pairDevice(auth, code, 'device-1', publicKeyPem, privateKeyPem);

    // First challenge-response.
    const n1 = auth.createChallenge();
    expect(auth.verifyResponse('device-1', n1, signNonce(privateKeyPem, n1))).toBe(true);

    // Second challenge-response (simulates reconnect).
    const n2 = auth.createChallenge();
    expect(auth.verifyResponse('device-1', n2, signNonce(privateKeyPem, n2))).toBe(true);
  });

  it('can re-pair after generating a new code (burned code scenario)', () => {
    const auth = createAuth();
    const { publicKeyPem, privateKeyPem } = generateKeyPair();

    // First pairing — burns the code.
    const code1 = auth.generatePairingCode();
    pairDevice(auth, code1, 'device-1', publicKeyPem, privateKeyPem);

    // Generate a new code and re-pair the same device.
    const code2 = auth.generatePairingCode();
    const { publicKeyPem: pub2, privateKeyPem: priv2 } = generateKeyPair();
    const r = pairDevice(auth, code2, 'device-1', pub2, priv2);
    expect(r.ok).toBe(true);

    // The device can authenticate with the new key.
    const nonce = auth.createChallenge();
    // Note: the old key no longer works because the binding was replaced.
    expect(auth.verifyResponse('device-1', nonce, signNonce(privateKeyPem, nonce))).toBe(false);
  });
});
