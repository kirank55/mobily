import { requireNativeModule } from 'expo-modules-core';
import { randomUUID } from 'expo-crypto';
import { parseDeviceBindingId, type DeviceBindingId } from '@mobily/shared';
import { LEGACY_KEY_ALIAS } from './storage';

interface MobilyDeviceKeyModule {
  createKey(alias: string): Promise<string>;
  sign(alias: string, payload: string, promptMessage: string, cancelButtonText: string): Promise<string | null>;
  hasKey(alias: string): Promise<boolean>;
  deleteKey(alias: string): Promise<boolean>;
  isAvailable(): Promise<boolean>;
}

let cachedModule: MobilyDeviceKeyModule | null = null;
function nativeModule(): MobilyDeviceKeyModule {
  cachedModule ??= requireNativeModule<MobilyDeviceKeyModule>('MobilyDeviceKey');
  return cachedModule;
}

export interface DeviceKeyResult {
  deviceBindingId: DeviceBindingId;
  keyAlias: string;
  publicKey: string;
}

export function keyAliasForBinding(deviceBindingId: DeviceBindingId): string {
  return `mobily.device.${deviceBindingId}`;
}

export async function createDeviceKey(deviceBindingId: DeviceBindingId): Promise<DeviceKeyResult> {
  const keyAlias = keyAliasForBinding(deviceBindingId);
  const publicKey = await nativeModule().createKey(keyAlias);
  return { deviceBindingId, keyAlias, publicKey };
}

export async function signNonce(
  nonce: string,
  promptMessage = 'Authenticate to connect to your Station',
  keyAlias = LEGACY_KEY_ALIAS,
): Promise<string | null> {
  return await nativeModule().sign(keyAlias, nonce, promptMessage, 'Cancel');
}

export async function keysExist(keyAlias = LEGACY_KEY_ALIAS): Promise<boolean> {
  return await nativeModule().hasKey(keyAlias);
}

export async function deleteKey(keyAlias: string): Promise<void> {
  await nativeModule().deleteKey(keyAlias);
}

/** Phase 3 compatibility: delete the legacy singleton key. */
export async function deleteKeys(): Promise<void> {
  await deleteKey(LEGACY_KEY_ALIAS);
}

export async function isBiometricsAvailable(): Promise<boolean> {
  return await nativeModule().isAvailable();
}

export function generateDeviceBindingId(): DeviceBindingId {
  const value = parseDeviceBindingId(`binding_${randomUUID().replaceAll('-', '')}`);
  if (!value) throw new Error('Failed to generate Device Binding ID');
  return value;
}
