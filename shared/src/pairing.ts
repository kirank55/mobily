const PAIRING_SCHEME = 'mobily:';
const PAIRING_HOST = 'pair';
const PAIRING_PAYLOAD_VERSION = 2;
const PAIRING_CODE_PATTERN = /^[A-HJ-KM-NP-Z2-9]{8}$/;
const DEVICE_BINDING_ID_PATTERN = /^binding_[A-Za-z0-9_-]{22,64}$/;
const CERTIFICATE_PIN_PATTERN = /^sha256\/[A-Za-z0-9+/]{43}=$/;
const STATION_FINGERPRINT_PATTERN = /^SHA256:[0-9A-F]{4}(?:-[0-9A-F]{4}){3}$/;

declare const deviceBindingIdBrand: unique symbol;
export type DeviceBindingId = string & { readonly [deviceBindingIdBrand]: true };

export function parseDeviceBindingId(value: unknown): DeviceBindingId | null {
  return typeof value === 'string' && DEVICE_BINDING_ID_PATTERN.test(value)
    ? (value as DeviceBindingId)
    : null;
}

export interface PairingPayload {
  readonly endpoint: string;
  readonly code: string;
  readonly expiresAt: number;
  readonly protocolVersion: number;
  /** Dynamic SPKI pin used only for the self-signed local Station endpoint. */
  readonly certificatePin?: string;
  /**
   * Human-comparable fingerprint of the persistent Station identity, shown by
   * both the CLI and the app so the user can detect a substituted pairing QR.
   */
  readonly stationFingerprint?: string;
}

/** Successful response from the Station pairing endpoint. */
export interface PairingResponse {
  readonly tunnelUrl: string;
  readonly stationName: string;
  readonly protocolVersion: number;
}

export function encodePairingPayload(payload: PairingPayload): string {
  validateEndpoint(payload.endpoint);
  validateCode(payload.code);
  validatePositiveInteger(payload.expiresAt, 'expiresAt');
  validatePositiveInteger(payload.protocolVersion, 'protocolVersion');

  const url = new URL(`${PAIRING_SCHEME}//${PAIRING_HOST}`);
  url.searchParams.set('v', String(PAIRING_PAYLOAD_VERSION));
  url.searchParams.set('endpoint', payload.endpoint);
  url.searchParams.set('code', payload.code);
  url.searchParams.set('expires', String(payload.expiresAt));
  url.searchParams.set('protocol', String(payload.protocolVersion));
  if (payload.certificatePin !== undefined) {
    validateCertificatePin(payload.certificatePin);
    url.searchParams.set('pin', payload.certificatePin);
  }
  if (payload.stationFingerprint !== undefined) {
    validateStationFingerprint(payload.stationFingerprint);
    url.searchParams.set('fid', payload.stationFingerprint);
  }
  return url.toString();
}

export function decodePairingPayload(raw: string, now = Date.now()): PairingPayload {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError('mobily/pairing: invalid mobily pairing QR');
  }

  if (url.protocol !== PAIRING_SCHEME || url.hostname !== PAIRING_HOST) {
    throw new TypeError('mobily/pairing: invalid mobily pairing QR');
  }
  if (url.searchParams.get('v') !== String(PAIRING_PAYLOAD_VERSION)) {
    throw new TypeError('mobily/pairing: unsupported payload version');
  }

  const endpoint = url.searchParams.get('endpoint') ?? '';
  const code = url.searchParams.get('code') ?? '';
  const expiresAt = Number(url.searchParams.get('expires'));
  const protocolVersion = Number(url.searchParams.get('protocol'));
  const certificatePin = url.searchParams.get('pin') ?? undefined;
  const stationFingerprint = url.searchParams.get('fid') ?? undefined;

  validateEndpoint(endpoint);
  validateCode(code);
  validatePositiveInteger(expiresAt, 'expiresAt');
  validatePositiveInteger(protocolVersion, 'protocolVersion');
  if (certificatePin !== undefined) validateCertificatePin(certificatePin);
  if (stationFingerprint !== undefined) validateStationFingerprint(stationFingerprint);
  if (expiresAt <= now) {
    throw new TypeError('mobily/pairing: pairing QR expired');
  }

  return {
    endpoint,
    code,
    expiresAt,
    protocolVersion,
    ...(certificatePin === undefined ? {} : { certificatePin }),
    ...(stationFingerprint === undefined ? {} : { stationFingerprint }),
  };
}

export function createPairingProofPayload(
  code: string,
  deviceId: string,
  publicKey: string,
  endpoint: string,
  certificatePin?: string,
): string {
  return ['mobily-pair-v2', endpoint, certificatePin ?? '', code, deviceId, publicKey].join('\n');
}

export function webSocketToPairingUrl(endpoint: string): string {
  const url = new URL(endpoint);
  if (url.protocol === 'wss:') url.protocol = 'https:';
  else if (url.protocol === 'ws:') url.protocol = 'http:';
  else throw new TypeError('mobily/pairing: endpoint must be a WebSocket URL');
  url.pathname = '/.well-known/mobily/pair';
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function isSecureWebSocketUrl(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === 'wss:' &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function validateEndpoint(endpoint: string): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new TypeError('mobily/pairing: endpoint must be a WebSocket URL');
  }
  if ((url.protocol !== 'ws:' && url.protocol !== 'wss:') || !url.hostname) {
    throw new TypeError('mobily/pairing: endpoint must be a WebSocket URL');
  }
  if (url.username || url.password || url.hash) {
    throw new TypeError('mobily/pairing: endpoint contains forbidden URL components');
  }
}

function validateCode(code: string): void {
  if (!PAIRING_CODE_PATTERN.test(code)) {
    throw new TypeError('mobily/pairing: invalid pairing code');
  }
}

function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`mobily/pairing: ${name} must be a positive integer`);
  }
}

function validateCertificatePin(value: string): void {
  if (!CERTIFICATE_PIN_PATTERN.test(value)) {
    throw new TypeError('mobily/pairing: invalid certificate pin');
  }
}

function validateStationFingerprint(value: string): void {
  if (!STATION_FINGERPRINT_PATTERN.test(value)) {
    throw new TypeError('mobily/pairing: invalid station fingerprint');
  }
}
