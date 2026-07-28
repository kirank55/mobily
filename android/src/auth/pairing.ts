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
import {
  createDeviceKey,
  deleteKey,
  generateDeviceBindingId,
  getDeviceKeyAvailability,
  signNonce,
  type DeviceKeyAvailability,
} from './deviceKey';
import { savePairing, type PairingRecord } from './storage';
import { pinnedJsonRequest } from '@/client/pinnedTransport';

/** Result of a pairing attempt. */
export interface PairResult {
  ok: boolean;
  record?: PairingRecord;
  error?: string;
}

/** Host (with port) of a validated Station endpoint, for identity display. */
export function stationHostName(endpoint: string): string {
  return new URL(endpoint).host;
}

const AVAILABILITY_ERRORS: Record<DeviceKeyAvailability['reason'], string> = {
  available: '',
  'secure-lock-screen-not-configured':
    'Set up a secure screen lock (PIN, pattern, or password) before pairing.',
  'strong-biometric-not-enrolled':
    'Enroll a strong biometric (usually a fingerprint) before pairing.',
  'biometric-hardware-unavailable':
    'Biometric hardware is temporarily unavailable. Try again in a moment.',
  'biometric-hardware-not-present':
    'This device does not have supported strong biometric hardware.',
  'biometric-security-update-required':
    'Install the device security update required for biometric authentication.',
  'strong-biometric-unsupported': 'This device does not support strong biometric authentication.',
  'context-unavailable': 'Biometric status is unavailable. Reopen the app and try again.',
  'biometric-status-unknown':
    'Android could not determine biometric availability. See the console for details.',
};

/**
 * Pair with a Station: send the pairing code + Device Key to the CLI,
 * store the result, and return the pairing record.
 *
 * @param baseUrl The CLI's base URL (e.g. http://192.168.1.100:51234)
 * @param code The short pairing code scanned from the QR
 */
export async function pairWithStation(pairing: PairingPayload): Promise<PairResult> {
  console.info('[Mobily][Pairing] Pairing started', {
    protocolVersion: pairing.protocolVersion,
    pinnedTransport: Boolean(pairing.certificatePin),
  });
  if (pairing.protocolVersion !== PROTOCOL_VERSION) {
    console.error('[Mobily][Pairing] Protocol version mismatch', {
      qrProtocolVersion: pairing.protocolVersion,
      appProtocolVersion: PROTOCOL_VERSION,
    });
    return { ok: false, error: 'Please update the app or CLI before pairing.' };
  }
  if (!isSecureWebSocketUrl(pairing.endpoint)) {
    console.warn('[Mobily][Pairing] Refused insecure Station transport', {
      endpoint: pairing.endpoint,
    });
    return { ok: false, error: 'Refusing insecure Station transport.' };
  }
  const stationHost = stationHostName(pairing.endpoint);

  console.info('[Mobily][Pairing] Checking secure lock screen and strong biometrics');
  let availability: DeviceKeyAvailability;
  try {
    availability = await getDeviceKeyAvailability();
  } catch (error) {
    console.error('[Mobily][Pairing] Device security check failed', error);
    return {
      ok: false,
      error: 'Cannot check device security. Reinstall the latest development build.',
    };
  }
  console.info('[Mobily][Pairing] Device security check completed', availability);
  if (!availability.available) {
    console.warn('[Mobily][Pairing] Device security requirements not met', {
      reason: availability.reason,
      biometricStatus: availability.biometricStatus,
      deviceSecure: availability.deviceSecure,
    });
    return {
      ok: false,
      error:
        AVAILABILITY_ERRORS[availability.reason] ??
        'Android could not determine biometric availability. See the console for details.',
    };
  }

  const deviceBindingId = generateDeviceBindingId();

  let publicKey: string;
  let keyAlias: string;
  let hardwareBacked: boolean;
  let securityLevel: string;
  console.info('[Mobily][Pairing] Creating Device Key in Android Keystore');
  try {
    const keyResult = await createDeviceKey(deviceBindingId);
    publicKey = keyResult.publicKey;
    keyAlias = keyResult.keyAlias;
    hardwareBacked = keyResult.hardwareBacked;
    securityLevel = keyResult.securityLevel;
  } catch (error) {
    console.error('[Mobily][Pairing] Device Key creation failed', error);
    return {
      ok: false,
      error: 'Android could not create the Device Key. See the console for details.',
    };
  }
  const keySecurity = { hardwareBacked, securityLevel };
  if (hardwareBacked) {
    console.info('[Mobily][Pairing] Device Key created', keySecurity);
  } else {
    console.warn(
      '[Mobily][Pairing] Device Key created without secure hardware backing',
      keySecurity,
    );
  }
  const fail = async (error: string): Promise<PairResult> => {
    try {
      await deleteKey(keyAlias);
    } catch (cleanupError) {
      // Best-effort cleanup; an unreferenced alias can be overwritten safely.
      console.warn('[Mobily][Pairing] Device Key cleanup failed', cleanupError);
    }
    console.warn('[Mobily][Pairing] Pairing failed', { reason: error });
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
  console.info('[Mobily][Pairing] Requesting biometric confirmation');
  try {
    proof = await signNonce(proofPayload, `Pair with ${stationHost}`, keyAlias);
  } catch (error) {
    console.error('[Mobily][Pairing] Device Key proof failed', error);
    return await fail('Failed to prove Device Key ownership.');
  }
  if (!proof) {
    return await fail('Pairing confirmation was cancelled.');
  }
  console.info('[Mobily][Pairing] Device Key ownership confirmed');

  let resp: { ok: boolean; status: number; json(): Promise<unknown> };
  console.info('[Mobily][Pairing] Sending pairing request to Station');
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
    console.error('[Mobily][Pairing] Station request failed', err);
    return await fail(
      `Cannot reach Station — ${err instanceof Error ? err.message : 'network error'}`,
    );
  }
  console.info('[Mobily][Pairing] Station responded', { status: resp.status, ok: resp.ok });

  if (!resp.ok) {
    let error = `Pairing failed (HTTP ${resp.status})`;
    let responseBody: unknown;
    try {
      responseBody = await resp.json();
      const body = responseBody as { error?: string };
      if (body.error) error = body.error;
    } catch {
      // ignore JSON parse errors
    }
    console.warn('[Mobily][Pairing] Station rejected pairing', {
      status: resp.status,
      error,
      responseBody,
    });
    return await fail(error);
  }

  let payload: PairingResponse;
  try {
    payload = (await resp.json()) as PairingResponse;
  } catch (error) {
    console.warn('[Mobily][Pairing] Station returned non-JSON pairing response', error);
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
    console.warn('[Mobily][Pairing] Station returned an invalid pairing response', {
      stationName:
        payload && typeof payload === 'object' && 'stationName' in payload
          ? payload.stationName
          : undefined,
      tunnelUrl:
        payload && typeof payload === 'object' && 'tunnelUrl' in payload
          ? payload.tunnelUrl
          : undefined,
      expectedTunnelUrl: pairing.endpoint,
      protocolVersion:
        payload && typeof payload === 'object' && 'protocolVersion' in payload
          ? payload.protocolVersion
          : undefined,
      expectedProtocolVersion: PROTOCOL_VERSION,
    });
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
  } catch (error) {
    console.error('[Mobily][Pairing] Saving pairing failed', error);
    return await fail('Could not save the paired Station.');
  }

  console.info('[Mobily][Pairing] Pairing completed', { stationName: record.stationName });
  return { ok: true, record };
}
