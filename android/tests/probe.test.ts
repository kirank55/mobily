import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDeviceBindingId } from '@mobily/shared';
import { probeStation } from '@/hosts/probe';
import type { PairingRecord } from '@/auth/storage';

const pairing: PairingRecord = {
  stationName: 'Test Station',
  tunnelUrl: 'wss://station.example.test',
  deviceBindingId: parseDeviceBindingId('binding_probeAAAAAAAAAAAAAAAAA')!,
  keyAlias: 'mobily.device.probe',
  pairedAt: 1_700_000_000_000,
};

describe('probeStation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('closes the reachability socket when the host screen loses focus', async () => {
    const close = vi.fn();
    vi.stubGlobal(
      'WebSocket',
      class {
        onopen: (() => void) | null = null;
        onclose: (() => void) | null = null;
        onerror: (() => void) | null = null;
        close = close;
      },
    );
    const controller = new AbortController();

    const result = probeStation(pairing, 3_000, controller.signal);
    controller.abort();

    expect(close).toHaveBeenCalledWith(1000, 'reachability probe complete');
    await expect(result).resolves.toBe(false);
  });
});
