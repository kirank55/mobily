/**
 * src/auth/storage.ts
 *
 * Encrypted storage for the pairing record using expo-secure-store.
 * Phase 3 stores a single record; the list/multi-station model arrives in Phase 4.
 */

import * as SecureStore from 'expo-secure-store';
import { isSecureWebSocketUrl, parseDeviceBindingId, type DeviceBindingId } from '@mobily/shared';

/** The single pairing record persisted on the device. */
export interface PairingRecord {
  stationName: string;
  tunnelUrl: string;
  deviceBindingId: DeviceBindingId;
  pairedAt: number;
  certificatePin?: string;
}

const STORAGE_KEY = 'mobily.pairing';

/** Save the pairing record to encrypted storage. */
export async function savePairing(record: PairingRecord): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(record));
}

/** Load the saved pairing record, or null if none. */
export async function loadPairing(): Promise<PairingRecord | null> {
  const raw = await SecureStore.getItemAsync(STORAGE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return isPairingRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function isPairingRecord(value: unknown): value is PairingRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['stationName'] === 'string' &&
    record['stationName'].length > 0 &&
    record['stationName'].length <= 255 &&
    typeof record['tunnelUrl'] === 'string' &&
    isSecureWebSocketUrl(record['tunnelUrl']) &&
    parseDeviceBindingId(record['deviceBindingId']) !== null &&
    typeof record['pairedAt'] === 'number' &&
    Number.isSafeInteger(record['pairedAt']) &&
    record['pairedAt'] > 0 &&
    (record['certificatePin'] === undefined ||
      (typeof record['certificatePin'] === 'string' &&
        /^sha256\/[A-Za-z0-9+/]{43}=$/.test(record['certificatePin'])))
  );
}

/** Delete the saved pairing record. */
export async function clearPairing(): Promise<void> {
  await SecureStore.deleteItemAsync(STORAGE_KEY);
}
