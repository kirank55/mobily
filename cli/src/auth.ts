/**
 * cli/src/auth.ts
 *
 * Device Key authentication and pairing for mobily.
 *
 * **Pairing flow:**
 *   1. CLI generates a short pairing code (cryptorandom, 8 chars).
 *   2. Phone scans the QR / enters the code and POSTs to
 *      `/.well-known/mobily/pair` with `{ code, deviceId, publicKey, proof }`.
 *   3. CLI validates the code, key, and endpoint-bound proof-of-possession, then stores the binding
 *      `{ deviceId, publicKey, stationName, pairedAt }`, burns the code, and
 *      returns `{ tunnelUrl, stationName, protocolVersion }`.
 *
 * **Reconnect flow (challenge-response):**
 *   1. CLI sends an `auth-challenge` frame with a random nonce.
 *   2. Phone signs the nonce with its Device Key private key (Android Keystore).
 *   3. Phone sends an `auth-response` frame with `{ deviceId, signature }`.
 *   4. CLI verifies the signature against the stored public key.
 *
 * The pairing code is single-use — burned after the first successful bind.
 * Device bindings are in-memory for Phase 2; persistence is a future enhancement.
 */

import {
  randomBytes,
  createPublicKey,
  createVerify,
  timingSafeEqual,
  type KeyObject,
} from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createPairingProofPayload, PROTOCOL_VERSION, type PairingResponse } from '@mobily/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A device that has been paired with this Station. */
export interface DeviceBinding {
  readonly deviceId: string;
  readonly publicKey: string;
  readonly stationName: string;
  readonly pairedAt: Date;
}

/** Result of a pairing attempt. */
interface PairResult {
  ok: boolean;
  status: number;
  body: PairingResponse | { error: string };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Unambiguous alphabet for pairing codes (no 0/O/1/I/L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const CODE_PATTERN = /^[A-HJ-KM-NP-Z2-9]{8}$/;
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const NONCE_LENGTH = 32; // bytes
const PAIRING_PATH = '/.well-known/mobily/pair';
const MAX_BODY_BYTES = 16 * 1024; // 16 KB — a public key is ~300 bytes
const MAX_DEVICE_ID_LENGTH = 128;
const MAX_PUBLIC_KEY_LENGTH = 8 * 1024;
const MAX_SIGNATURE_LENGTH = 4 * 1024;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

// ---------------------------------------------------------------------------
// AuthManager
// ---------------------------------------------------------------------------

/**
 * Manages pairing codes, device bindings, and challenge-response auth.
 * One instance per CLI process.
 */
export class AuthManager {
  private pairingCode: string | null = null;
  private codeExpiresAt: Date | null = null;
  private codeBurned = false;

  private readonly boundDevices = new Map<string, DeviceBinding>();

  private tunnelUrl: string | null = null;

  constructor(private readonly stationName: string) {}

  /** Set the tunnel URL (after the tunnel connects). Required before pairing. */
  setTunnelUrl(url: string): void {
    this.tunnelUrl = url;
  }

  // -------------------------------------------------------------------------
  // Pairing code
  // -------------------------------------------------------------------------

  /** Generate a new pairing code. Any previous code is replaced. */
  generatePairingCode(): string {
    const bytes = randomBytes(CODE_LENGTH);
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
    }
    this.pairingCode = code;
    this.codeExpiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);
    this.codeBurned = false;
    return code;
  }

  /** The current pairing code, or `null` if none has been generated. */
  get currentPairingCode(): string | null {
    if (!this.pairingCode || this.codeBurned) return null;
    if (this.codeExpiresAt && this.codeExpiresAt < new Date()) return null;
    return this.pairingCode;
  }

  // -------------------------------------------------------------------------
  // Pairing (HTTP endpoint)
  // -------------------------------------------------------------------------

  /**
   * Validate a pairing request and bind the device if the code is valid.
   * Called by the HTTP handler for `POST /.well-known/mobily/pair`.
   */
  pair(code: string, deviceId: string, publicKey: string, proof: string): PairResult {
    if (!this.tunnelUrl) {
      return { ok: false, status: 503, body: { error: 'Tunnel is not ready.' } };
    }

    if (!code || !deviceId || !publicKey || !proof) {
      return {
        ok: false,
        status: 400,
        body: { error: 'Missing code, deviceId, publicKey, or proof.' },
      };
    }

    if (this.codeBurned || !pairingCodesEqual(this.pairingCode, code)) {
      return { ok: false, status: 403, body: { error: 'Invalid pairing code.' } };
    }

    if (this.codeExpiresAt && this.codeExpiresAt < new Date()) {
      return { ok: false, status: 403, body: { error: 'Pairing code expired.' } };
    }

    if (
      deviceId.length > MAX_DEVICE_ID_LENGTH ||
      !DEVICE_ID_PATTERN.test(deviceId) ||
      publicKey.length > MAX_PUBLIC_KEY_LENGTH ||
      proof.length > MAX_SIGNATURE_LENGTH
    ) {
      return { ok: false, status: 400, body: { error: 'Invalid pairing fields.' } };
    }

    const parsedKey = parseAndValidatePublicKey(publicKey);
    if (!parsedKey) {
      return { ok: false, status: 400, body: { error: 'Unsupported Device Key.' } };
    }

    const proofPayload = createPairingProofPayload(code, deviceId, publicKey, this.tunnelUrl);
    if (!verifySignature(parsedKey, proofPayload, proof)) {
      return { ok: false, status: 403, body: { error: 'Invalid pairing proof.' } };
    }

    // Bind the device and burn the code.
    this.boundDevices.set(deviceId, {
      deviceId,
      publicKey: parsedKey.export({ type: 'spki', format: 'pem' }).toString(),
      stationName: this.stationName,
      pairedAt: new Date(),
    });
    this.codeBurned = true;

    return {
      ok: true,
      status: 200,
      body: {
        tunnelUrl: this.tunnelUrl,
        stationName: this.stationName,
        protocolVersion: PROTOCOL_VERSION,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Challenge-response (WS)
  // -------------------------------------------------------------------------

  /** Is a device with the given ID bound? */
  isDeviceBound(deviceId: string): boolean {
    return this.boundDevices.has(deviceId);
  }

  /**
   * Create a nonce challenge. The nonce is a cryptorandom base64 string.
   * The device proves identity by signing this nonce in `verifyResponse`.
   */
  createChallenge(): string {
    return randomBytes(NONCE_LENGTH).toString('base64');
  }

  /**
   * Verify a challenge response: the signature must be the device's
   * private-key signature of the nonce, verifiable with the stored public key.
   */
  verifyResponse(deviceId: string, nonce: string, signature: string): boolean {
    const binding = this.boundDevices.get(deviceId);
    if (!binding) return false;

    try {
      return verifySignature(createPublicKey(binding.publicKey), nonce, signature);
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // HTTP handler
  // -------------------------------------------------------------------------

  /**
   * Handle an HTTP request. Routes `POST /.well-known/mobily/pair` to the
   * pairing logic; all other requests get 404.
   */
  handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    if (req.method === 'POST' && req.url === PAIRING_PATH) {
      this.handlePairing(req, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found.' }));
  }

  /** Internal: read and process a pairing POST. */
  private handlePairing(req: IncomingMessage, res: ServerResponse): void {
    let body = '';
    let tooLarge = false;
    let receivedBytes = 0;

    req.on('data', (chunk: Buffer) => {
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_BODY_BYTES) {
        tooLarge = true;
        if (!res.headersSent) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Request body too large.' }));
        }
        req.destroy();
        return;
      }
      body += chunk.toString('utf8');
    });

    req.on('end', () => {
      if (tooLarge || res.writableEnded) return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON.' }));
        return;
      }

      if (!isPairingRequest(parsed)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid pairing request.' }));
        return;
      }

      const result = this.pair(parsed.code, parsed.deviceId, parsed.publicKey, parsed.proof);

      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.body));
    });

    req.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request error.' }));
      }
    });
  }
}

function parseAndValidatePublicKey(value: string): KeyObject | null {
  try {
    const key = value.includes('BEGIN PUBLIC KEY')
      ? createPublicKey(value)
      : createPublicKey({ key: Buffer.from(value, 'base64'), format: 'der', type: 'spki' });

    if (key.asymmetricKeyType === 'rsa') {
      const bits = key.asymmetricKeyDetails?.modulusLength ?? 0;
      return bits >= 2048 ? key : null;
    }
    if (key.asymmetricKeyType === 'ec') {
      const curve = key.asymmetricKeyDetails?.namedCurve;
      return curve === 'prime256v1' || curve === 'secp384r1' ? key : null;
    }
    return null;
  } catch {
    return null;
  }
}

function verifySignature(key: KeyObject, payload: string, signature: string): boolean {
  try {
    const verify = createVerify('SHA256');
    verify.update(payload);
    verify.end();
    return verify.verify(key, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

function pairingCodesEqual(expected: string | null, actual: string): boolean {
  if (!expected || !CODE_PATTERN.test(actual)) return false;
  const expectedBytes = Buffer.from(expected, 'ascii');
  const actualBytes = Buffer.from(actual, 'ascii');
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

function isPairingRequest(
  value: unknown,
): value is { code: string; deviceId: string; publicKey: string; proof: string } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return (
    typeof request['code'] === 'string' &&
    typeof request['deviceId'] === 'string' &&
    typeof request['publicKey'] === 'string' &&
    typeof request['proof'] === 'string'
  );
}
