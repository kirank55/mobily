package expo.modules.mobilyforeground

import android.Manifest
import android.os.Build
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private class ForegroundModuleException(message: String) : CodedException(message)

class MobilyForegroundModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MobilyForeground")

    AsyncFunction("requestNotificationPermission") { promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
        promise.resolve(true)
        return@AsyncFunction
      }
      val permissions = appContext.permissions
      if (permissions == null) {
        promise.reject(ForegroundModuleException("Android permissions manager is unavailable"))
        return@AsyncFunction
      }
      permissions.askForPermissions({ result ->
        promise.resolve(
          result[Manifest.permission.POST_NOTIFICATIONS]?.status == PermissionsStatus.GRANTED
        )
      }, Manifest.permission.POST_NOTIFICATIONS)
    }

    AsyncFunction("start") { stationName: String ->
      val context = appContext.reactContext
        ?: throw ForegroundModuleException("Android application context is unavailable")
      MobilyForegroundService.start(context, bounded(stationName, 80, "Station"))
    }

    AsyncFunction("update") { state: String, lastLine: String, alert: String? ->
      val context = appContext.reactContext
        ?: throw ForegroundModuleException("Android application context is unavailable")
      MobilyForegroundService.update(
        context,
        bounded(state, 40, "connected"),
        bounded(lastLine, 160, "Waiting for terminal output"),
        alert?.let { bounded(it, 512, "") }
      )
    }

    AsyncFunction("stop") {
      appContext.reactContext?.let(MobilyForegroundService::stop)
    }
  }

  private fun bounded(value: String, maxLength: Int, fallback: String): String {
    val plain = value.filter { it.code >= 0x20 && it.code != 0x7f }
      .replace(Regex("\\s+"), " ")
      .trim()
    return (plain.ifEmpty { fallback }).take(maxLength)
  }
}
