/**
 * src/auth/pairing.ts
 *
 * HTTPS handshake with the CLI pairing endpoint.
 * Sends the pairing code + Device Key public key, receives the connection payload.
 */

import {
  createPairingProofPayload,
  isSecureWebSocketUrl,
  PROTOCOL_VERSION,
  webSocketToPairingUrl,
  type PairingPayload,
  type PairingResponse,
} from '@mobily/shared';
import { createDeviceKey, deleteKey, generateDeviceBindingId, signNonce } from './deviceKey';
import { savePairing, type PairingRecord } from './storage';
import { pinnedJsonRequest } from '@/client/pinnedTransport';

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
export async function pairWithStation(
  pairing: PairingPayload,
  options: { allowInsecureTransport?: boolean } = {},
): Promise<PairResult> {
  if (pairing.protocolVersion !== PROTOCOL_VERSION) {
    return { ok: false, error: 'Please update the app or CLI before pairing.' };
  }
  const insecureDevelopmentOverride = __DEV__ && options.allowInsecureTransport === true;
  if (!isSecureWebSocketUrl(pairing.endpoint) && !insecureDevelopmentOverride) {
    return { ok: false, error: 'Refusing insecure Station transport.' };
  }

  const deviceBindingId = generateDeviceBindingId();

  let publicKey: string;
  let keyAlias: string;
  try {
    const keyResult = await createDeviceKey(deviceBindingId);
    publicKey = keyResult.publicKey;
    keyAlias = keyResult.keyAlias;
  } catch {
    return { ok: false, error: 'Failed to create Device Key. Is biometrics set up?' };
  }
  const fail = async (error: string): Promise<PairResult> => {
    try {
      await deleteKey(keyAlias);
    } catch {
      // Best-effort cleanup; an unreferenced alias can be overwritten safely.
    }
    return { ok: false, error };
  };

  const proofPayload = createPairingProofPayload(
    pairing.code,
    deviceBindingId,
    publicKey,
    pairing.endpoint,
    pairing.certificatePin,
  );
  let proof: string | null;
  try {
    proof = await signNonce(proofPayload, 'Confirm pairing with this Station', keyAlias);
  } catch {
    return await fail('Failed to prove Device Key ownership.');
  }
  if (!proof) {
    return await fail('Pairing confirmation was cancelled.');
  }

  let resp: { ok: boolean; status: number; json(): Promise<unknown> };
  try {
    const body = { code: pairing.code, deviceId: deviceBindingId, publicKey, proof };
    resp = pairing.certificatePin
      ? await pinnedJsonRequest(
          webSocketToPairingUrl(pairing.endpoint),
          pairing.certificatePin,
          body,
        )
      : await fetch(webSocketToPairingUrl(pairing.endpoint), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
  } catch (err) {
    return await fail(
      `Cannot reach Station — ${err instanceof Error ? err.message : 'network error'}`,
    );
  }

  if (!resp.ok) {
    let error = `Pairing failed (HTTP ${resp.status})`;
    try {
      const body = (await resp.json()) as { error?: string };
      if (body.error) error = body.error;
    } catch {
      // ignore JSON parse errors
    }
    return await fail(error);
  }

  let payload: PairingResponse;
  try {
    payload = (await resp.json()) as PairingResponse;
  } catch {
    return await fail('Station returned an invalid pairing response.');
  }
  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof payload.stationName !== 'string' ||
    payload.stationName.length === 0 ||
    payload.stationName.length > 255 ||
    payload.tunnelUrl !== pairing.endpoint ||
    payload.protocolVersion !== PROTOCOL_VERSION
  ) {
    return await fail('Station returned an invalid pairing response.');
  }

  const record: PairingRecord = {
    stationName: payload.stationName,
    tunnelUrl: payload.tunnelUrl,
    deviceBindingId,
    keyAlias,
    pairedAt: Date.now(),
    certificatePin: pairing.certificatePin,
  };

  try {
    await savePairing(record);
  } catch {
    return await fail('Could not save the paired Station.');
  }

  return { ok: true, record };
}
