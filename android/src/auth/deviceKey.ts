import { requireNativeModule } from 'expo-modules-core';
import { randomUUID } from 'expo-crypto';
import { parseDeviceBindingId, type DeviceBindingId } from '@mobily/shared';
import { LEGACY_KEY_ALIAS } from './storage';

interface NativeDeviceKeyResult {
  publicKey: string;
  hardwareBacked: boolean;
  securityLevel: 'strongbox' | 'trusted-environment' | 'software';
}

interface MobilyDeviceKeyModule {
  createKey(alias: string): Promise<NativeDeviceKeyResult>;
  sign(
    alias: string,
    payload: string,
    promptMessage: string,
    cancelButtonText: string,
  ): Promise<string | null>;
  hasKey(alias: string): Promise<boolean>;
  deleteKey(alias: string): Promise<boolean>;
  isAvailable(): Promise<boolean>;
  getAvailability(): Promise<DeviceKeyAvailability>;
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
  hardwareBacked: boolean;
  securityLevel: NativeDeviceKeyResult['securityLevel'];
}

export type DeviceKeyAvailabilityReason =
  | 'available'
  | 'secure-lock-screen-not-configured'
  | 'strong-biometric-not-enrolled'
  | 'biometric-hardware-unavailable'
  | 'biometric-hardware-not-present'
  | 'biometric-security-update-required'
  | 'strong-biometric-unsupported'
  | 'context-unavailable'
  | 'biometric-status-unknown';

export interface DeviceKeyAvailability {
  available: boolean;
  reason: DeviceKeyAvailabilityReason;
  biometricStatus: number;
  deviceSecure: boolean;
}

export function keyAliasForBinding(deviceBindingId: DeviceBindingId): string {
  return `mobily.device.${deviceBindingId}`;
}

export async function createDeviceKey(deviceBindingId: DeviceBindingId): Promise<DeviceKeyResult> {
  const keyAlias = keyAliasForBinding(deviceBindingId);
  const key = await nativeModule().createKey(keyAlias);
  return { deviceBindingId, keyAlias, ...key };
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

export async function getDeviceKeyAvailability(): Promise<DeviceKeyAvailability> {
  return await nativeModule().getAvailability();
}

export function generateDeviceBindingId(): DeviceBindingId {
  const value = parseDeviceBindingId(`binding_${randomUUID().replaceAll('-', '')}`);
  if (!value) throw new Error('Failed to generate Device Binding ID');
  return value;
}
