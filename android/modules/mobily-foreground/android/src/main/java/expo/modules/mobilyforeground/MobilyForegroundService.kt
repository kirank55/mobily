package expo.modules.mobilyforeground

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

class MobilyForegroundService : Service() {
  private var stationName = "Station"
  private var state = "connecting"
  private var lastLine = "Waiting for terminal output"

  override fun onCreate() {
    super.onCreate()
    createChannels()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> stationName = intent.getStringExtra(EXTRA_STATION_NAME) ?: stationName
      ACTION_UPDATE -> {
        state = intent.getStringExtra(EXTRA_STATE) ?: state
        lastLine = intent.getStringExtra(EXTRA_LAST_LINE) ?: lastLine
      }
    }

    val serviceType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
    } else {
      0
    }
    ServiceCompat.startForeground(this, SERVICE_NOTIFICATION_ID, serviceNotification(), serviceType)

    intent?.getStringExtra(EXTRA_ALERT)?.takeIf(String::isNotBlank)?.let(::postAlert)
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  private fun serviceNotification() = NotificationCompat.Builder(this, SERVICE_CHANNEL_ID)
    .setSmallIcon(applicationInfo.icon.takeIf { it != 0 } ?: android.R.drawable.stat_notify_sync)
    .setContentTitle("$stationName terminal: $state")
    .setContentText(lastLine)
    .setStyle(NotificationCompat.BigTextStyle().bigText(lastLine))
    .setContentIntent(launchIntent())
    .setCategory(NotificationCompat.CATEGORY_SERVICE)
    .setPriority(NotificationCompat.PRIORITY_LOW)
    .setOngoing(true)
    .setOnlyAlertOnce(true)
    .build()

  private fun postAlert(message: String) {
    val notification = NotificationCompat.Builder(this, ALERT_CHANNEL_ID)
      .setSmallIcon(applicationInfo.icon.takeIf { it != 0 } ?: android.R.drawable.stat_notify_sync)
      .setContentTitle("$stationName needs attention")
      .setContentText(message)
      .setStyle(NotificationCompat.BigTextStyle().bigText(message))
      .setContentIntent(launchIntent())
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setAutoCancel(true)
      .build()
    getSystemService(NotificationManager::class.java).notify(ALERT_NOTIFICATION_ID, notification)
  }

  private fun launchIntent(): PendingIntent? {
    val intent = packageManager.getLaunchIntentForPackage(packageName) ?: return null
    intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(
      this,
      0,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  private fun createChannels() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
      NotificationChannel(SERVICE_CHANNEL_ID, "Active terminal", NotificationManager.IMPORTANCE_LOW)
    )
    manager.createNotificationChannel(
      NotificationChannel(ALERT_CHANNEL_ID, "Terminal alerts", NotificationManager.IMPORTANCE_HIGH)
    )
  }

  companion object {
    private const val ACTION_START = "expo.modules.mobilyforeground.START"
    private const val ACTION_UPDATE = "expo.modules.mobilyforeground.UPDATE"
    private const val EXTRA_STATION_NAME = "stationName"
    private const val EXTRA_STATE = "state"
    private const val EXTRA_LAST_LINE = "lastLine"
    private const val EXTRA_ALERT = "alert"
    private const val SERVICE_CHANNEL_ID = "mobily-terminal-session"
    private const val ALERT_CHANNEL_ID = "mobily-terminal-alerts"
    private const val SERVICE_NOTIFICATION_ID = 7011
    private const val ALERT_NOTIFICATION_ID = 7012

    fun start(context: Context, stationName: String) {
      val intent = Intent(context, MobilyForegroundService::class.java)
        .setAction(ACTION_START)
        .putExtra(EXTRA_STATION_NAME, stationName)
      ContextCompat.startForegroundService(context, intent)
    }

    fun update(context: Context, state: String, lastLine: String, alert: String?) {
      val intent = Intent(context, MobilyForegroundService::class.java)
        .setAction(ACTION_UPDATE)
        .putExtra(EXTRA_STATE, state)
        .putExtra(EXTRA_LAST_LINE, lastLine)
      if (alert != null) intent.putExtra(EXTRA_ALERT, alert)
      context.startService(intent)
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, MobilyForegroundService::class.java))
    }
  }
}
