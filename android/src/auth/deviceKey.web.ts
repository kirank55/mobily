/**
 * Web Crypto Device Key for Expo web (__DEV__ insecure local only).
 * Mirrors cli/dev/smoke.html: ECDSA P-256, IEEE P1363 → DER for Node verify.
 */

import { randomUUID } from 'expo-crypto';
import { parseDeviceBindingId, type DeviceBindingId } from '@mobily/shared';
import { LEGACY_KEY_ALIAS } from './storage';

export interface DeviceKeyResult {
  deviceBindingId: DeviceBindingId;
  keyAlias: string;
  publicKey: string;
  hardwareBacked: boolean;
  securityLevel: 'strongbox' | 'trusted-environment' | 'software';
}

export type DeviceKeyAvailabilityReason =
  | 'available'
  | 'secure-lock-screen-not-configured'
  | 'strong-biometric-not-enrolled'
  | 'biometric-hardware-unavailable'
  | 'biometric-hardware-not-present'
  | 'biometric-security-update-required'
  | 'strong-biometric-unsupported'
  | 'context-unavailable'
  | 'biometric-status-unknown';

export interface DeviceKeyAvailability {
  available: boolean;
  reason: DeviceKeyAvailabilityReason;
  biometricStatus: number;
  deviceSecure: boolean;
}

const STORAGE_PREFIX = 'mobily.web-device-key.v1.';
const memoryKeys = new Map<string, CryptoKeyPair>();

export function keyAliasForBinding(deviceBindingId: DeviceBindingId): string {
  return `mobily.device.${deviceBindingId}`;
}

export async function createDeviceKey(deviceBindingId: DeviceBindingId): Promise<DeviceKeyResult> {
  const keyAlias = keyAliasForBinding(deviceBindingId);
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  memoryKeys.set(keyAlias, pair);
  await persistKeyPair(keyAlias, pair);
  const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
  return {
    deviceBindingId,
    keyAlias,
    publicKey: spkiToPem(new Uint8Array(spki)),
    hardwareBacked: false,
    securityLevel: 'software',
  };
}

export async function signNonce(
  nonce: string,
  _promptMessage = 'Authenticate to connect to your Station',
  keyAlias = LEGACY_KEY_ALIAS,
): Promise<string | null> {
  const pair = await loadKeyPair(keyAlias);
  if (!pair) return null;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    pair.privateKey,
    new TextEncoder().encode(nonce),
  );
  return bytesToBase64(ecRawToDer(new Uint8Array(signature)));
}

export async function keysExist(keyAlias = LEGACY_KEY_ALIAS): Promise<boolean> {
  return (await loadKeyPair(keyAlias)) !== null;
}

export async function deleteKey(keyAlias: string): Promise<void> {
  memoryKeys.delete(keyAlias);
  try {
    localStorage.removeItem(STORAGE_PREFIX + keyAlias);
  } catch {
    // ignore
  }
}

export async function deleteKeys(): Promise<void> {
  await deleteKey(LEGACY_KEY_ALIAS);
}

export async function isBiometricsAvailable(): Promise<boolean> {
  return true;
}

export async function getDeviceKeyAvailability(): Promise<DeviceKeyAvailability> {
  return {
    available: typeof crypto !== 'undefined' && !!crypto.subtle,
    reason: 'available',
    biometricStatus: 0,
    deviceSecure: true,
  };
}

export function generateDeviceBindingId(): DeviceBindingId {
  const value = parseDeviceBindingId(`binding_${randomUUID().replaceAll('-', '')}`);
  if (!value) throw new Error('Failed to generate Device Binding ID');
  return value;
}

async function persistKeyPair(alias: string, pair: CryptoKeyPair): Promise<void> {
  const [publicJwk, privateJwk] = await Promise.all([
    crypto.subtle.exportKey('jwk', pair.publicKey),
    crypto.subtle.exportKey('jwk', pair.privateKey),
  ]);
  try {
    localStorage.setItem(STORAGE_PREFIX + alias, JSON.stringify({ publicJwk, privateJwk }));
  } catch {
    // Memory-only if storage is unavailable.
  }
}

async function loadKeyPair(alias: string): Promise<CryptoKeyPair | null> {
  const cached = memoryKeys.get(alias);
  if (cached) return cached;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_PREFIX + alias);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { publicJwk: JsonWebKey; privateJwk: JsonWebKey };
    const pair: CryptoKeyPair = {
      publicKey: await crypto.subtle.importKey(
        'jwk',
        parsed.publicJwk,
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['verify'],
      ),
      privateKey: await crypto.subtle.importKey(
        'jwk',
        parsed.privateJwk,
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign'],
      ),
    };
    memoryKeys.set(alias, pair);
    return pair;
  } catch {
    return null;
  }
}

function spkiToPem(bytes: Uint8Array): string {
  const b64 = bytesToBase64(bytes);
  const lines = b64.match(/.{1,64}/g) ?? [b64];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----\n`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Web Crypto ECDSA is IEEE P1363 (r||s); Node createVerify expects DER. */
function ecRawToDer(raw: Uint8Array): Uint8Array {
  const r = raw.subarray(0, 32);
  const s = raw.subarray(32, 64);
  const derInt = (value: Uint8Array): number[] => {
    let i = 0;
    while (i < value.length - 1 && value[i] === 0) i++;
    const out = Array.from(value.subarray(i));
    if ((out[0] ?? 0) & 0x80) out.unshift(0);
    return [0x02, out.length, ...out];
  };
  const body = [...derInt(r), ...derInt(s)];
  return new Uint8Array([0x30, body.length, ...body]);
}
