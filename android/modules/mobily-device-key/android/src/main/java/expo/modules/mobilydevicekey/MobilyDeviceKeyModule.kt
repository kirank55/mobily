package expo.modules.mobilydevicekey

import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.UserNotAuthenticatedException
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.UnrecoverableKeyException
import java.security.spec.RSAKeyGenParameterSpec
import java.util.Collections

private class DeviceKeyException(message: String, cause: Throwable? = null) :
  CodedException(message, cause)

private class DeviceKeyUnavailableException(message: String, cause: Throwable? = null) :
  CodedException(message, cause)

private class DeviceKeyInvalidatedException(message: String, cause: Throwable? = null) :
  CodedException(message, cause)

private class BiometricAuthenticationException(message: String, cause: Throwable? = null) :
  CodedException(message, cause)

class MobilyDeviceKeyModule : Module() {
  private val authenticatedAliases = Collections.synchronizedSet(mutableSetOf<String>())

  override fun definition() = ModuleDefinition {
    Name("MobilyDeviceKey")

    AsyncFunction("createKey") { alias: String ->
      try {
        validateAlias(alias)
        val keyStore = keyStore()
        if (keyStore.containsAlias(alias)) keyStore.deleteEntry(alias)
        authenticatedAliases.remove(alias)
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, "AndroidKeyStore")
        val keySpec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
          .setDigests(KeyProperties.DIGEST_SHA256)
          .setSignaturePaddings(KeyProperties.SIGNATURE_PADDING_RSA_PKCS1)
          .setAlgorithmParameterSpec(RSAKeyGenParameterSpec(2048, RSAKeyGenParameterSpec.F4))
          .setUserAuthenticationRequired(true)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          keySpec.setUserAuthenticationParameters(
            SESSION_AUTH_VALIDITY_SECONDS,
            KeyProperties.AUTH_BIOMETRIC_STRONG,
          )
        } else {
          @Suppress("DEPRECATION")
          keySpec.setUserAuthenticationValidityDurationSeconds(SESSION_AUTH_VALIDITY_SECONDS)
        }
        generator.initialize(keySpec.build())
        val keyPair = generator.generateKeyPair()
        val keyInfo = KeyFactory.getInstance(keyPair.private.algorithm, "AndroidKeyStore")
          .getKeySpec(keyPair.private, KeyInfo::class.java)
        val hardwareBacked = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          keyInfo.securityLevel == KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT ||
            keyInfo.securityLevel == KeyProperties.SECURITY_LEVEL_STRONGBOX
        } else {
          @Suppress("DEPRECATION")
          keyInfo.isInsideSecureHardware
        }
        val securityLevel = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          when (keyInfo.securityLevel) {
            KeyProperties.SECURITY_LEVEL_STRONGBOX -> "strongbox"
            KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> "trusted-environment"
            else -> "software"
          }
        } else if (hardwareBacked) {
          "trusted-environment"
        } else {
          "software"
        }
        mapOf(
          "publicKey" to Base64.encodeToString(keyPair.public.encoded, Base64.NO_WRAP),
          "hardwareBacked" to hardwareBacked,
          "securityLevel" to securityLevel,
        )
      } catch (error: Throwable) {
        throw DeviceKeyException(
          "Could not create the Device Key: ${error.message ?: error.javaClass.simpleName}",
          error,
        )
      }
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
      authenticatedAliases.remove(alias)
      existed
    }

    AsyncFunction("isAvailable") {
      availability()["available"] == true
    }

    AsyncFunction("getAvailability") {
      availability()
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
          ?: throw DeviceKeyUnavailableException("Device Key is unavailable; pair this Station again")
        if (authenticatedAliases.contains(alias)) {
          try {
            promise.resolve(signPayload(privateKey as java.security.PrivateKey, payload))
            return@AsyncFunction
          } catch (_: UserNotAuthenticatedException) {
            authenticatedAliases.remove(alias)
          }
        }
        val signature = Signature.getInstance("SHA256withRSA")
        signature.initSign(privateKey as java.security.PrivateKey)
        val executor = ContextCompat.getMainExecutor(activity)
        val callback = object : BiometricPrompt.AuthenticationCallback() {
          override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
            try {
              val authenticated = result.cryptoObject?.signature
                ?: throw DeviceKeyException("Biometric authentication did not unlock the Device Key")
              authenticated.update(payload.toByteArray(Charsets.UTF_8))
              val encoded = Base64.encodeToString(authenticated.sign(), Base64.NO_WRAP)
              authenticatedAliases.add(alias)
              promise.resolve(encoded)
            } catch (error: Throwable) {
              if (error is KeyPermanentlyInvalidatedException) {
                promise.reject(
                  DeviceKeyInvalidatedException(
                    "Device Key was permanently invalidated; pair this Station again",
                    error,
                  )
                )
              } else {
                promise.reject(
                  DeviceKeyException(
                    "Could not sign the Station challenge: ${error.message ?: error.javaClass.simpleName}",
                    error,
                  )
                )
              }
            }
          }

          override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
            if (
              errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
              errorCode == BiometricPrompt.ERROR_USER_CANCELED
            ) {
              promise.resolve(null)
            } else {
              promise.reject(
                BiometricAuthenticationException(
                  "Biometric authentication failed ($errorCode): $errString"
                )
              )
            }
          }
        }
        activity.runOnUiThread {
          try {
            val biometricPrompt = BiometricPrompt(activity, executor, callback)
            val prompt = BiometricPrompt.PromptInfo.Builder()
              .setTitle(promptMessage)
              .setNegativeButtonText(cancelButtonText)
              .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
              .build()
            biometricPrompt.authenticate(prompt, BiometricPrompt.CryptoObject(signature))
          } catch (error: Throwable) {
            promise.reject(
              BiometricAuthenticationException(
                "Could not start biometric authentication: ${error.message ?: error.javaClass.simpleName}",
                error,
              )
            )
          }
        }
      } catch (error: KeyPermanentlyInvalidatedException) {
        promise.reject(
          DeviceKeyInvalidatedException(
            "Device Key was permanently invalidated; pair this Station again",
            error,
          )
        )
      } catch (error: DeviceKeyUnavailableException) {
        promise.reject(error)
      } catch (error: UnrecoverableKeyException) {
        promise.reject(
          DeviceKeyUnavailableException(
            "Device Key could not be recovered; pair this Station again",
            error,
          )
        )
      } catch (error: Throwable) {
        promise.reject(
          DeviceKeyException(
            "Could not access the Device Key: ${error.message ?: error.javaClass.simpleName}",
            error,
          )
        )
      }
    }
  }

  private fun availability(): Map<String, Any> {
    val context = appContext.reactContext
      ?: return mapOf(
        "available" to false,
        "reason" to "context-unavailable",
        "biometricStatus" to BiometricManager.BIOMETRIC_STATUS_UNKNOWN,
        "deviceSecure" to false,
      )
    val keyguardManager = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    val deviceSecure = keyguardManager.isDeviceSecure
    val biometricStatus = BiometricManager.from(context).canAuthenticate(
      BiometricManager.Authenticators.BIOMETRIC_STRONG
    )
    val reason = when {
      !deviceSecure -> "secure-lock-screen-not-configured"
      biometricStatus == BiometricManager.BIOMETRIC_SUCCESS -> "available"
      biometricStatus == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED ->
        "strong-biometric-not-enrolled"
      biometricStatus == BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE ->
        "biometric-hardware-unavailable"
      biometricStatus == BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE ->
        "biometric-hardware-not-present"
      biometricStatus == BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED ->
        "biometric-security-update-required"
      biometricStatus == BiometricManager.BIOMETRIC_ERROR_UNSUPPORTED ->
        "strong-biometric-unsupported"
      else -> "biometric-status-unknown"
    }
    return mapOf(
      "available" to (deviceSecure && biometricStatus == BiometricManager.BIOMETRIC_SUCCESS),
      "reason" to reason,
      "biometricStatus" to biometricStatus,
      "deviceSecure" to deviceSecure,
    )
  }

  private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  private fun signPayload(privateKey: java.security.PrivateKey, payload: String): String {
    val signature = Signature.getInstance("SHA256withRSA")
    signature.initSign(privateKey)
    signature.update(payload.toByteArray(Charsets.UTF_8))
    return Base64.encodeToString(signature.sign(), Base64.NO_WRAP)
  }

  private fun validateAlias(alias: String) {
    if (!alias.matches(Regex("^[A-Za-z0-9_.-]{1,255}$"))) {
      throw DeviceKeyException("Invalid Device Key alias")
    }
  }

  companion object {
    // The in-memory alias set still forces one biometric check per app process.
    // This validity window lets reconnect challenges sign without prompting again.
    private const val SESSION_AUTH_VALIDITY_SECONDS = 24 * 60 * 60
  }
}
