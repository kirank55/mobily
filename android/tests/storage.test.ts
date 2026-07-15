import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDeviceBindingId } from '@mobily/shared';

const memory = vi.hoisted(() => new Map<string, string>());
const secureStore = vi.hoisted(() => ({
  getItemAsync: vi.fn(async (key: string) => memory.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    memory.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    memory.delete(key);
  }),
}));

vi.mock('expo-secure-store', () => secureStore);

import {
  LEGACY_KEY_ALIAS,
  listPairings,
  loadPairing,
  removePairing,
  savePairing,
  selectPairing,
  type PairingRecord,
} from '@/auth/storage';

function record(suffix: string): PairingRecord {
  return {
    stationName: `station-${suffix}`,
    tunnelUrl: `wss://${suffix}.example.test`,
    deviceBindingId: parseDeviceBindingId(`binding_${suffix.padEnd(22, 'A')}`)!,
    keyAlias: `mobily_${suffix}`,
    pairedAt: 1_700_000_000_000,
  };
}

describe('pairing storage', () => {
  beforeEach(() => {
    memory.clear();
    vi.clearAllMocks();
  });

  it('stores multiple pairings and persists the selected Station', async () => {
    const first = record('first');
    const second = record('second');
    await savePairing(first);
    await savePairing(second);

    await expect(listPairings()).resolves.toEqual([first, second]);
    await expect(loadPairing()).resolves.toEqual(second);

    await selectPairing(first.deviceBindingId);
    await expect(loadPairing()).resolves.toEqual(first);
  });

  it('migrates the Phase 3 singleton without invalidating its legacy key', async () => {
    const legacy = { ...record('legacy') } as Omit<PairingRecord, 'keyAlias'> & {
      keyAlias?: string;
    };
    delete legacy.keyAlias;
    memory.set('mobily.pairing', JSON.stringify(legacy));

    await expect(listPairings()).resolves.toEqual([
      expect.objectContaining({ deviceBindingId: legacy.deviceBindingId, keyAlias: LEGACY_KEY_ALIAS }),
    ]);
    expect(memory.has('mobily.pairing')).toBe(false);
    expect(memory.has('mobily.pairings.v2')).toBe(true);
  });

  it('removes only the requested Station and selects a remaining pairing', async () => {
    const first = record('first');
    const second = record('second');
    await savePairing(first);
    await savePairing(second);

    await removePairing(second.deviceBindingId);

    await expect(listPairings()).resolves.toEqual([first]);
    await expect(loadPairing()).resolves.toEqual(first);
  });

  it('rejects malformed persisted list data', async () => {
    memory.set('mobily.pairings.v2', JSON.stringify([{ stationName: 'missing fields' }]));
    await expect(listPairings()).resolves.toEqual([]);
  });
});
