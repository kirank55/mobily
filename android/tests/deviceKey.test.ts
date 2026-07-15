import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDeviceBindingId } from '@mobily/shared';

const native = vi.hoisted(() => ({
  createKey: vi.fn(),
  sign: vi.fn(),
  hasKey: vi.fn(),
  deleteKey: vi.fn(),
  isAvailable: vi.fn(),
  getAvailability: vi.fn(),
}));
vi.mock('expo-modules-core', () => ({ requireNativeModule: () => native }));
vi.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000000' }));

import {
  createDeviceKey,
  deleteKey,
  getDeviceKeyAvailability,
  keyAliasForBinding,
  signNonce,
} from '@/auth/deviceKey';

const bindingId = parseDeviceBindingId('binding_AAAAAAAAAAAAAAAAAAAAAA')!;

describe('per-Station Device Keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.createKey.mockResolvedValue({
      publicKey: 'public-key',
      hardwareBacked: true,
      securityLevel: 'trusted-environment',
    });
    native.sign.mockResolvedValue('signature');
    native.getAvailability.mockResolvedValue({
      available: true,
      reason: 'available',
      biometricStatus: 0,
      deviceSecure: true,
    });
  });

  it('creates a deterministic distinct Keystore alias for a Device Binding ID', async () => {
    const alias = keyAliasForBinding(bindingId);
    await expect(createDeviceKey(bindingId)).resolves.toEqual({
      deviceBindingId: bindingId,
      keyAlias: alias,
      publicKey: 'public-key',
      hardwareBacked: true,
      securityLevel: 'trusted-environment',
    });
    expect(native.createKey).toHaveBeenCalledWith(alias);
  });

  it('signs and deletes using the selected Station alias', async () => {
    const alias = keyAliasForBinding(bindingId);
    await expect(signNonce('challenge', 'Authenticate', alias)).resolves.toBe('signature');
    expect(native.sign).toHaveBeenCalledWith(alias, 'challenge', 'Authenticate', 'Cancel');

    await deleteKey(alias);
    expect(native.deleteKey).toHaveBeenCalledWith(alias);
  });

  it('reports the native secure-lock-screen and biometric availability result', async () => {
    await expect(getDeviceKeyAvailability()).resolves.toEqual({
      available: true,
      reason: 'available',
      biometricStatus: 0,
      deviceSecure: true,
    });
    expect(native.getAvailability).toHaveBeenCalledOnce();
  });
});
