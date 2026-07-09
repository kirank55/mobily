/**
 * src/auth/pairing.ts
 *
 * HTTPS handshake with the CLI pairing endpoint.
 * Sends the pairing code + Device Key public key, receives the connection payload.
 */

import { createDeviceKey, generateDeviceId } from './deviceKey';
import { savePairing, type PairingRecord } from './storage';

/** Response from the CLI pairing endpoint. */
export interface PairingResponse {
  tunnelUrl: string;
  stationName: string;
  protocolVersion: number;
}

/** Result of a pairing attempt. */
export interface PairResult {
  ok: boolean;
  record?: PairingRecord;
  error?: string;
}

/**
 * Pair with a Station: send the pairing code + Device Key to the CLI,
 * store the result, and return the pairing record.
 *
 * @param baseUrl The CLI's base URL (e.g. http://192.168.1.100:51234)
 * @param code The short pairing code scanned from the QR
 */
export async function pairWithStation(baseUrl: string, code: string): Promise<PairResult> {
  const deviceId = generateDeviceId();

  let publicKey: string;
  try {
    const keyResult = await createDeviceKey(deviceId);
    publicKey = keyResult.publicKey;
  } catch {
    return { ok: false, error: 'Failed to create Device Key. Is biometrics set up?' };
  }

  let resp: Response;
  try {
    resp = await fetch(`${baseUrl}/.well-known/mobily/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, deviceId, publicKey }),
    });
  } catch (err) {
    return {
      ok: false,
      error: `Cannot reach Station — ${err instanceof Error ? err.message : 'network error'}`,
    };
  }

  if (!resp.ok) {
    let error = `Pairing failed (HTTP ${resp.status})`;
    try {
      const body = (await resp.json()) as { error?: string };
      if (body.error) error = body.error;
    } catch {
      // ignore JSON parse errors
    }
    return { ok: false, error };
  }

  const payload = (await resp.json()) as PairingResponse;

  const record: PairingRecord = {
    stationName: payload.stationName,
    tunnelUrl: payload.tunnelUrl,
    deviceId,
    pairedAt: Date.now(),
  };

  await savePairing(record);

  return { ok: true, record };
}
