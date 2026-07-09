/**
 * src/auth/storage.ts
 *
 * Encrypted storage for the pairing record using expo-secure-store.
 * Phase 3 stores a single record; the list/multi-station model arrives in Phase 4.
 */

import * as SecureStore from 'expo-secure-store';

/** The single pairing record persisted on the device. */
export interface PairingRecord {
  stationName: string;
  tunnelUrl: string;
  deviceId: string;
  pairedAt: number;
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
    return JSON.parse(raw) as PairingRecord;
  } catch {
    return null;
  }
}

/** Delete the saved pairing record. */
export async function clearPairing(): Promise<void> {
  await SecureStore.deleteItemAsync(STORAGE_KEY);
}
