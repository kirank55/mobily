# Device binding via react-native-biometrics keypair

The device-binding auth model uses a cryptographic keypair generated in Android Keystore via `react-native-biometrics`, rather than a client-generated UUID stored in encrypted storage.

On pairing, the app generates a keypair in hardware-backed Android Keystore and sends the public key to the CLI. On reconnect, the CLI issues a nonce challenge and the app signs it with the private key. `react-native-biometrics` requires a biometric prompt for signing, which doubles as session-hijack protection.

This replaces session tokens entirely — every reconnect is authenticated by a fresh cryptographic challenge. There is no long-lived token to steal, rotate, or expire. The only stored secret is the private key in Android Keystore (hardware-backed, non-extractable).

**Considered alternatives:**

- **Client-generated UUID in `expo-secure-store`** — simplest (~40 lines), but the UUID is copyable if device storage is compromised. No real device-binding.
- **Custom Expo native module** — full control over Android Keystore without biometric prompt, but requires ~60 lines of Kotlin and ongoing native maintenance.
- **Session tokens with Device Key as second factor** — rejected because the Device Key challenge-response is strictly stronger than token-based auth; session tokens add complexity without security benefit.

We picked `react-native-biometrics` because it gives hardware-backed non-extractable keys with zero native code to maintain. The biometric prompt on reconnect is an acceptable UX trade — it's a brief interaction and prevents unauthorized use of an unlocked phone.
