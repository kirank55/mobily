# Device binding via a biometric Android Keystore keypair

The device-binding auth model uses a cryptographic keypair generated in Android Keystore through a local Expo native module, rather than a client-generated UUID stored in encrypted storage.

On pairing, the app generates a non-exportable Android Keystore keypair and sends the public key to the CLI. It inspects and reports whether the key is backed by a trusted execution environment or StrongBox. On reconnect, the CLI issues a nonce challenge and the app uses `BiometricPrompt` to authorize signing with the private key.

This replaces session tokens entirely — every reconnect is authenticated by a fresh cryptographic challenge. There is no long-lived token to steal, rotate, or expire. The only stored secret is the non-exportable private key in Android Keystore. Software backing remains supported for devices and emulators without secure hardware.

**Considered alternatives:**

- **Client-generated UUID in `expo-secure-store`** — simplest (~40 lines), but the UUID is copyable if device storage is compromised. No real device-binding.
- **`react-native-biometrics`** — less native code to maintain, but insufficient control over per-Station aliases, prerequisite diagnostics, error classification, and Keystore security-level reporting.
- **Session tokens with Device Key as second factor** — rejected because the Device Key challenge-response is strictly stronger than token-based auth; session tokens add complexity without security benefit.

We picked a local Expo native module to keep per-Station keys non-exportable while controlling biometric policy and diagnostics. The biometric prompt on reconnect is an acceptable UX trade — it's a brief interaction and prevents unauthorized use of an unlocked phone.
