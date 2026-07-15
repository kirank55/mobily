import { PROTOCOL_VERSION, type PairingPayload, parseDeviceBindingId } from '@mobily/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const bindingId = parseDeviceBindingId('binding_AAAAAAAAAAAAAAAAAAAAAA')!;
const deviceKey = vi.hoisted(() => ({
  createDeviceKey: vi.fn(),
  generateDeviceBindingId: vi.fn(),
  signNonce: vi.fn(),
}));
const storage = vi.hoisted(() => ({ savePairing: vi.fn() }));
const pinnedTransport = vi.hoisted(() => ({ pinnedJsonRequest: vi.fn() }));

vi.mock('@/auth/deviceKey', () => deviceKey);
vi.mock('@/auth/storage', () => storage);
vi.mock('@/client/pinnedTransport', () => pinnedTransport);

import { pairWithStation } from '@/auth/pairing';

const pairing: PairingPayload = {
  endpoint: 'wss://station.example.devtunnels.ms',
  code: 'ABCDEFG2',
  expiresAt: Date.now() + 60_000,
  protocolVersion: PROTOCOL_VERSION,
};

beforeEach(() => {
  vi.clearAllMocks();
  deviceKey.generateDeviceBindingId.mockReturnValue(bindingId);
  deviceKey.createDeviceKey.mockResolvedValue({
    deviceBindingId: bindingId,
    keyAlias: 'mobily.device.test',
    publicKey: 'key',
  });
  deviceKey.signNonce.mockResolvedValue('proof');
});

describe('pairWithStation()', () => {
  it('validates the Station response before saving a pairing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            stationName: 'test-station',
            tunnelUrl: pairing.endpoint,
            protocolVersion: PROTOCOL_VERSION,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    await expect(pairWithStation(pairing)).resolves.toMatchObject({
      ok: true,
      record: { stationName: 'test-station', deviceBindingId: bindingId },
    });
    expect(storage.savePairing).toHaveBeenCalledOnce();
  });

  it('rejects endpoint substitution in a successful HTTP response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            stationName: 'attacker',
            tunnelUrl: 'wss://other.example.devtunnels.ms',
            protocolVersion: PROTOCOL_VERSION,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    await expect(pairWithStation(pairing)).resolves.toEqual({
      ok: false,
      error: 'Station returned an invalid pairing response.',
    });
    expect(storage.savePairing).not.toHaveBeenCalled();
  });

  it('uses the native pinned request for a self-signed local Station', async () => {
    const localPairing = {
      ...pairing,
      endpoint: 'wss://192.168.1.2:4567',
      certificatePin: 'sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    };
    pinnedTransport.pinnedJsonRequest.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        stationName: 'local-station',
        tunnelUrl: localPairing.endpoint,
        protocolVersion: PROTOCOL_VERSION,
      }),
    });

    await expect(pairWithStation(localPairing)).resolves.toMatchObject({
      ok: true,
      record: { certificatePin: localPairing.certificatePin },
    });
    expect(pinnedTransport.pinnedJsonRequest).toHaveBeenCalledWith(
      'https://192.168.1.2:4567/.well-known/mobily/pair',
      localPairing.certificatePin,
      expect.objectContaining({ deviceId: bindingId }),
    );
    expect(deviceKey.signNonce).toHaveBeenCalledWith(
      expect.stringContaining(localPairing.certificatePin),
      'Confirm pairing with this Station',
      'mobily.device.test',
    );
  });
});
