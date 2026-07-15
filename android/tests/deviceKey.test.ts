import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDeviceBindingId } from '@mobily/shared';

const native = vi.hoisted(() => ({
  createKey: vi.fn(),
  sign: vi.fn(),
  hasKey: vi.fn(),
  deleteKey: vi.fn(),
  isAvailable: vi.fn(),
}));
vi.mock('expo-modules-core', () => ({ requireNativeModule: () => native }));
vi.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000000' }));

import {
  createDeviceKey,
  deleteKey,
  keyAliasForBinding,
  signNonce,
} from '@/auth/deviceKey';

const bindingId = parseDeviceBindingId('binding_AAAAAAAAAAAAAAAAAAAAAA')!;

describe('per-Station Device Keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.createKey.mockResolvedValue('public-key');
    native.sign.mockResolvedValue('signature');
  });

  it('creates a deterministic distinct Keystore alias for a Device Binding ID', async () => {
    const alias = keyAliasForBinding(bindingId);
    await expect(createDeviceKey(bindingId)).resolves.toEqual({
      deviceBindingId: bindingId,
      keyAlias: alias,
      publicKey: 'public-key',
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
});
