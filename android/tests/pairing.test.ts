import { PROTOCOL_VERSION, type PairingPayload, parseDeviceBindingId } from '@mobily/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const bindingId = parseDeviceBindingId('binding_AAAAAAAAAAAAAAAAAAAAAA')!;
const deviceKey = vi.hoisted(() => ({
  createDeviceKey: vi.fn(),
  deleteKey: vi.fn(),
  getDeviceKeyAvailability: vi.fn(),
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
  deviceKey.getDeviceKeyAvailability.mockResolvedValue({
    available: true,
    reason: 'available',
    biometricStatus: 0,
    deviceSecure: true,
  });
  deviceKey.generateDeviceBindingId.mockReturnValue(bindingId);
  deviceKey.createDeviceKey.mockResolvedValue({
    deviceBindingId: bindingId,
    keyAlias: 'mobily.device.test',
    publicKey: 'key',
    hardwareBacked: true,
    securityLevel: 'trusted-environment',
  });
  deviceKey.signNonce.mockResolvedValue('proof');
});

describe('pairWithStation()', () => {
  it('logs protocol versions when the QR version does not match the app', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      pairWithStation({ ...pairing, protocolVersion: PROTOCOL_VERSION + 1 }),
    ).resolves.toEqual({
      ok: false,
      error: 'Please update the app or CLI before pairing.',
    });
    expect(errorSpy).toHaveBeenCalledWith('[Mobily][Pairing] Protocol version mismatch', {
      qrProtocolVersion: PROTOCOL_VERSION + 1,
      appProtocolVersion: PROTOCOL_VERSION,
    });
    expect(deviceKey.getDeviceKeyAvailability).not.toHaveBeenCalled();
  });

  it('stops before key generation when a secure lock screen is not configured', async () => {
    deviceKey.getDeviceKeyAvailability.mockResolvedValue({
      available: false,
      reason: 'secure-lock-screen-not-configured',
      biometricStatus: 11,
      deviceSecure: false,
    });

    await expect(pairWithStation(pairing)).resolves.toEqual({
      ok: false,
      error: 'Set up a secure screen lock (PIN, pattern, or password) before pairing.',
    });
    expect(deviceKey.createDeviceKey).not.toHaveBeenCalled();
  });

  it('logs the native error when Device Key creation fails', async () => {
    const nativeError = new Error('AndroidKeyStore is unavailable');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    deviceKey.createDeviceKey.mockRejectedValue(nativeError);

    await expect(pairWithStation(pairing)).resolves.toEqual({
      ok: false,
      error: 'Android could not create the Device Key. See the console for details.',
    });
    expect(errorSpy).toHaveBeenCalledWith(
      '[Mobily][Pairing] Device Key creation failed',
      nativeError,
    );
  });

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
    expect(deviceKey.signNonce).toHaveBeenCalledWith(
      expect.any(String),
      'Pair with station.example.devtunnels.ms',
      'mobily.device.test',
    );
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
      'Pair with 192.168.1.2:4567',
      'mobily.device.test',
    );
  });
});
