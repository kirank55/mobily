/** Versioned encrypted persistence for paired Stations. */

import * as SecureStore from 'expo-secure-store';
import { isSecureWebSocketUrl, parseDeviceBindingId, type DeviceBindingId } from '@mobily/shared';

export const LEGACY_KEY_ALIAS = 'biometric_key';

export interface PairingRecord {
  stationName: string;
  tunnelUrl: string;
  deviceBindingId: DeviceBindingId;
  keyAlias: string;
  pairedAt: number;
  lastConnectedAt?: number;
  certificatePin?: string;
}

const LEGACY_STORAGE_KEY = 'mobily.pairing';
const PAIRINGS_STORAGE_KEY = 'mobily.pairings.v2';
const SELECTED_STORAGE_KEY = 'mobily.selected-pairing.v2';
export const PAIRING_RETENTION_MS = 2 * 24 * 60 * 60 * 1_000;

export async function listPairings(): Promise<PairingRecord[]> {
  const stored = await readPairings();
  if (stored !== null) return stored;
  return await migrateLegacyPairing();
}

/** Save or replace one pairing and make it the selected Station. */
export async function savePairing(record: PairingRecord): Promise<void> {
  if (!isPairingRecord(record)) throw new TypeError('Invalid pairing record');
  const pairings = await listPairings();
  const index = pairings.findIndex((entry) => entry.deviceBindingId === record.deviceBindingId);
  if (index >= 0) pairings[index] = record;
  else pairings.push(record);
  await writePairings(pairings);
  await SecureStore.setItemAsync(SELECTED_STORAGE_KEY, record.deviceBindingId);
}

/** Load the selected pairing, falling back to the first valid record. */
export async function loadPairing(): Promise<PairingRecord | null> {
  const pairings = await listPairings();
  if (pairings.length === 0) return null;
  const selected = await SecureStore.getItemAsync(SELECTED_STORAGE_KEY);
  return pairings.find((entry) => entry.deviceBindingId === selected) ?? pairings[0]!;
}

export async function selectPairing(deviceBindingId: DeviceBindingId): Promise<void> {
  const pairings = await listPairings();
  if (!pairings.some((entry) => entry.deviceBindingId === deviceBindingId)) {
    throw new Error('Paired Station not found');
  }
  await SecureStore.setItemAsync(SELECTED_STORAGE_KEY, deviceBindingId);
}

export async function removePairing(
  deviceBindingId: DeviceBindingId,
): Promise<PairingRecord | null> {
  const pairings = await listPairings();
  const removed = pairings.find((entry) => entry.deviceBindingId === deviceBindingId) ?? null;
  if (!removed) return null;
  const remaining = pairings.filter((entry) => entry.deviceBindingId !== deviceBindingId);
  await writePairings(remaining);
  const selected = await SecureStore.getItemAsync(SELECTED_STORAGE_KEY);
  if (selected === deviceBindingId) {
    if (remaining[0]) {
      await SecureStore.setItemAsync(SELECTED_STORAGE_KEY, remaining[0].deviceBindingId);
    } else {
      await SecureStore.deleteItemAsync(SELECTED_STORAGE_KEY);
    }
  }
  return removed;
}

export async function markConnected(
  deviceBindingId: DeviceBindingId,
  connectedAt = Date.now(),
): Promise<void> {
  const pairings = await listPairings();
  const index = pairings.findIndex((entry) => entry.deviceBindingId === deviceBindingId);
  if (index < 0) return;
  pairings[index] = { ...pairings[index]!, lastConnectedAt: connectedAt };
  await writePairings(pairings);
}

/**
 * Remove Stations that have not been opened within the retention window.
 * The removed records are returned so callers can also delete their Keystore keys.
 */
export async function pruneStalePairings(now = Date.now()): Promise<PairingRecord[]> {
  const pairings = await listPairings();
  const cutoff = now - PAIRING_RETENTION_MS;
  const removed = pairings.filter((entry) => (entry.lastConnectedAt ?? entry.pairedAt) < cutoff);
  if (removed.length === 0) return [];

  const removedIds = new Set(removed.map((entry) => entry.deviceBindingId));
  const remaining = pairings.filter((entry) => !removedIds.has(entry.deviceBindingId));
  await writePairings(remaining);

  const selected = await SecureStore.getItemAsync(SELECTED_STORAGE_KEY);
  if (selected && removed.some((entry) => entry.deviceBindingId === selected)) {
    if (remaining[0]) {
      await SecureStore.setItemAsync(SELECTED_STORAGE_KEY, remaining[0].deviceBindingId);
    } else {
      await SecureStore.deleteItemAsync(SELECTED_STORAGE_KEY);
    }
  }
  return removed;
}

/** Phase 3 compatibility: remove only the currently selected pairing. */
export async function clearPairing(): Promise<PairingRecord | null> {
  const selected = await loadPairing();
  return selected ? await removePairing(selected.deviceBindingId) : null;
}

async function readPairings(): Promise<PairingRecord[] | null> {
  const raw = await SecureStore.getItemAsync(PAIRINGS_STORAGE_KEY);
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) && value.every(isPairingRecord) ? value : [];
  } catch {
    return [];
  }
}

async function migrateLegacyPairing(): Promise<PairingRecord[]> {
  const raw = await SecureStore.getItemAsync(LEGACY_STORAGE_KEY);
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isLegacyPairingRecord(value)) return [];
    const migrated: PairingRecord = { ...value, keyAlias: LEGACY_KEY_ALIAS };
    await writePairings([migrated]);
    await SecureStore.setItemAsync(SELECTED_STORAGE_KEY, migrated.deviceBindingId);
    await SecureStore.deleteItemAsync(LEGACY_STORAGE_KEY);
    return [migrated];
  } catch {
    return [];
  }
}

async function writePairings(pairings: PairingRecord[]): Promise<void> {
  await SecureStore.setItemAsync(PAIRINGS_STORAGE_KEY, JSON.stringify(pairings));
}

function isPairingRecord(value: unknown): value is PairingRecord {
  return isLegacyPairingRecord(value) && isKeyAlias((value as Record<string, unknown>)['keyAlias']);
}

function isLegacyPairingRecord(value: unknown): value is Omit<PairingRecord, 'keyAlias'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['stationName'] === 'string' &&
    record['stationName'].length > 0 &&
    record['stationName'].length <= 255 &&
    typeof record['tunnelUrl'] === 'string' &&
    isSecureWebSocketUrl(record['tunnelUrl']) &&
    parseDeviceBindingId(record['deviceBindingId']) !== null &&
    validTimestamp(record['pairedAt']) &&
    (record['lastConnectedAt'] === undefined || validTimestamp(record['lastConnectedAt'])) &&
    (record['certificatePin'] === undefined ||
      (typeof record['certificatePin'] === 'string' &&
        /^sha256\/[A-Za-z0-9+/]{43}=$/.test(record['certificatePin'])))
  );
}

function isKeyAlias(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,255}$/.test(value);
}

function validTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
