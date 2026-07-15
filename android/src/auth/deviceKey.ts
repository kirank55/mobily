/**
 * src/auth/deviceKey.ts
 *
 * Device Key management via react-native-biometrics.
 * The keypair is generated in Android Keystore (hardware-backed, non-extractable).
 * The public key is sent to the CLI during pairing; the private key signs nonce
 * challenges on reconnect (with a biometric prompt each time).
 */

import ReactNativeBiometrics from 'react-native-biometrics';
import { randomUUID } from 'expo-crypto';
import { parseDeviceBindingId, type DeviceBindingId } from '@mobily/shared';

const rnBiometrics = new ReactNativeBiometrics();

/** Result of creating a Device Key. */
export interface DeviceKeyResult {
  deviceBindingId: DeviceBindingId;
  publicKey: string;
}

/**
 * Create a new Device Key keypair in Android Keystore.
 * Shows a biometric prompt for key creation.
 * Returns the PEM public key and a stable device ID.
 */
export async function createDeviceKey(deviceBindingId: DeviceBindingId): Promise<DeviceKeyResult> {
  const { publicKey } = await rnBiometrics.createKeys();
  return { deviceBindingId, publicKey };
}

/**
 * Sign a nonce challenge with the Device Key private key.
 * Shows a biometric prompt each time (session-hijack protection per ADR 0001).
 * Returns the base64 DER-encoded ECDSA signature, or null if the user cancels.
 */
export async function signNonce(
  nonce: string,
  promptMessage = 'Authenticate to connect to your Station',
): Promise<string | null> {
  const result = await rnBiometrics.createSignature({
    promptMessage,
    payload: nonce,
    cancelButtonText: 'Cancel',
  });
  if (!result.success || !result.signature) return null;
  return result.signature;
}

/** Check if Device Key keys exist in the Keystore. */
export async function keysExist(): Promise<boolean> {
  const { keysExist } = await rnBiometrics.biometricKeysExist();
  return keysExist;
}

/** Delete the Device Key keypair from the Keystore. */
export async function deleteKeys(): Promise<void> {
  await rnBiometrics.deleteKeys();
}

/** Check if biometrics is available on this device. */
export async function isBiometricsAvailable(): Promise<boolean> {
  const { available } = await rnBiometrics.isSensorAvailable();
  return available;
}

/** Generate a cryptographically random identifier for a Station binding. */
export function generateDeviceBindingId(): DeviceBindingId {
  const value = parseDeviceBindingId(`binding_${randomUUID().replaceAll('-', '')}`);
  if (!value) throw new Error('Failed to generate Device Binding ID');
  return value;
}
