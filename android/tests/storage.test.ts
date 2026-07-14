import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDeviceBindingId } from '@mobily/shared';

const secureStore = vi.hoisted(() => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

vi.mock('expo-secure-store', () => secureStore);

import { loadPairing, savePairing } from '@/auth/storage';

describe('pairing storage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('round-trips a valid pairing record through encrypted storage', async () => {
    const record = {
      stationName: 'dev-station',
      tunnelUrl: 'wss://station.example.devtunnels.ms',
      deviceBindingId: parseDeviceBindingId('binding_AAAAAAAAAAAAAAAAAAAAAA')!,
      pairedAt: 1_700_000_000_000,
      certificatePin: 'sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    };
    await savePairing(record);
    secureStore.getItemAsync.mockResolvedValue(JSON.stringify(record));

    await expect(loadPairing()).resolves.toEqual(record);
    expect(secureStore.setItemAsync).toHaveBeenCalledWith('mobily.pairing', JSON.stringify(record));
  });

  it('rejects malformed persisted data', async () => {
    for (const value of [
      '{',
      JSON.stringify({ stationName: 'missing fields' }),
      JSON.stringify({
        stationName: 'dev-station',
        tunnelUrl: 'http://insecure.example',
        deviceBindingId: 'bad id',
        pairedAt: -1,
      }),
    ]) {
      secureStore.getItemAsync.mockResolvedValueOnce(value);
      await expect(loadPairing()).resolves.toBeNull();
    }
  });
});
