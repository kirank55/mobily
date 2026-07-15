package expo.modules.mobilydevicekey

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.spec.RSAKeyGenParameterSpec

private class DeviceKeyException(message: String, cause: Throwable? = null) :
  CodedException(message, cause)

class MobilyDeviceKeyModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MobilyDeviceKey")

    AsyncFunction("createKey") { alias: String ->
      validateAlias(alias)
      val keyStore = keyStore()
      if (keyStore.containsAlias(alias)) keyStore.deleteEntry(alias)
      val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, "AndroidKeyStore")
      generator.initialize(
        KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
          .setDigests(KeyProperties.DIGEST_SHA256)
          .setSignaturePaddings(KeyProperties.SIGNATURE_PADDING_RSA_PKCS1)
          .setAlgorithmParameterSpec(RSAKeyGenParameterSpec(2048, RSAKeyGenParameterSpec.F4))
          .setUserAuthenticationRequired(true)
          .build()
      )
      Base64.encodeToString(generator.generateKeyPair().public.encoded, Base64.NO_WRAP)
    }

    AsyncFunction("hasKey") { alias: String ->
      validateAlias(alias)
      keyStore().containsAlias(alias)
    }

    AsyncFunction("deleteKey") { alias: String ->
      validateAlias(alias)
      val keyStore = keyStore()
      val existed = keyStore.containsAlias(alias)
      if (existed) keyStore.deleteEntry(alias)
      existed
    }

    AsyncFunction("isAvailable") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      BiometricManager.from(context).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) ==
        BiometricManager.BIOMETRIC_SUCCESS
    }

    AsyncFunction("sign") {
        alias: String,
        payload: String,
        promptMessage: String,
        cancelButtonText: String,
        promise: Promise ->
      try {
        validateAlias(alias)
        val activity = appContext.currentActivity as? FragmentActivity
          ?: throw DeviceKeyException("A foreground Activity is required for authentication")
        val privateKey = keyStore().getKey(alias, null)
          ?: throw DeviceKeyException("Device Key is unavailable; pair this Station again")
        val signature = Signature.getInstance("SHA256withRSA")
        signature.initSign(privateKey as java.security.PrivateKey)
        val executor = ContextCompat.getMainExecutor(activity)
        val callback = object : BiometricPrompt.AuthenticationCallback() {
          override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
            try {
              val authenticated = result.cryptoObject?.signature
                ?: throw DeviceKeyException("Biometric authentication did not unlock the Device Key")
              authenticated.update(payload.toByteArray(Charsets.UTF_8))
              promise.resolve(Base64.encodeToString(authenticated.sign(), Base64.NO_WRAP))
            } catch (error: Throwable) {
              promise.reject(DeviceKeyException("Could not sign the Station challenge", error))
            }
          }

          override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
            if (
              errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
              errorCode == BiometricPrompt.ERROR_USER_CANCELED ||
              errorCode == BiometricPrompt.ERROR_CANCELED
            ) {
              promise.resolve(null)
            } else {
              promise.reject(DeviceKeyException(errString.toString()))
            }
          }
        }
        activity.runOnUiThread {
          val biometricPrompt = BiometricPrompt(activity, executor, callback)
          val prompt = BiometricPrompt.PromptInfo.Builder()
            .setTitle(promptMessage)
            .setNegativeButtonText(cancelButtonText)
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .build()
          biometricPrompt.authenticate(prompt, BiometricPrompt.CryptoObject(signature))
        }
      } catch (error: Throwable) {
        promise.reject(DeviceKeyException("Could not access the Device Key", error))
      }
    }
  }

  private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  private fun validateAlias(alias: String) {
    if (!alias.matches(Regex("^[A-Za-z0-9_.-]{1,255}$"))) {
      throw DeviceKeyException("Invalid Device Key alias")
    }
  }
}
