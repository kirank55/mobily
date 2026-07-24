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

    AsyncFunction("start") {
      val context = appContext.reactContext
        ?: throw ForegroundModuleException("Android application context is unavailable")
      MobilyForegroundService.start(context)
    }

    AsyncFunction("update") { connected: Boolean ->
      val context = appContext.reactContext
        ?: throw ForegroundModuleException("Android application context is unavailable")
      MobilyForegroundService.update(context, connected)
    }

    AsyncFunction("stop") {
      appContext.reactContext?.let(MobilyForegroundService::stop)
    }
  }

}
