---
status: accepted
---

# Device Key signing uses a short biometric grace window

Every reconnect still signs a fresh Station nonce with the non-exportable Device Key, but keys created from this decision onward use a 1800-second strong-biometric authentication validity window. The native signer first attempts the fresh signature without UI and opens `BiometricPrompt` only when Android reports that recent authentication is absent or expired. This removes repeated prompts during pairing and brief reconnect bursts while keeping the Station challenge fresh and the private key hardware-bound.

Existing per-use Device Keys remain supported and retain their original prompt behavior because an Android Keystore key’s authentication policy cannot be changed in place; pairing the Station again creates a key with the grace-window policy. Longer-lived session tokens remain rejected because they would introduce a transferable credential and weaken Device Key binding.
