const PAIRING_SCHEME = 'mobily:';
const PAIRING_HOST = 'pair';
const PAIRING_PAYLOAD_VERSION = 1;
const PAIRING_CODE_PATTERN = /^[A-HJ-KM-NP-Z2-9]{8}$/;

export interface PairingPayload {
  readonly endpoint: string;
  readonly code: string;
  readonly expiresAt: number;
  readonly protocolVersion: number;
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

  validateEndpoint(endpoint);
  validateCode(code);
  validatePositiveInteger(expiresAt, 'expiresAt');
  validatePositiveInteger(protocolVersion, 'protocolVersion');
  if (expiresAt <= now) {
    throw new TypeError('mobily/pairing: pairing QR expired');
  }

  return { endpoint, code, expiresAt, protocolVersion };
}

export function createPairingProofPayload(
  code: string,
  deviceId: string,
  publicKey: string,
  endpoint: string,
): string {
  return ['mobily-pair-v1', endpoint, code, deviceId, publicKey].join('\n');
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
