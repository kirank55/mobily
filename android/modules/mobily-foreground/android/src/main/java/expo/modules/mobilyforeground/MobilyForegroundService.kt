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
  private var connected = false

  override fun onCreate() {
    super.onCreate()
    createChannels()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_UPDATE -> connected = intent.getBooleanExtra(EXTRA_CONNECTED, false)
    }

    val serviceType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
    } else {
      0
    }
    ServiceCompat.startForeground(this, SERVICE_NOTIFICATION_ID, serviceNotification(), serviceType)

    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  private fun serviceNotification(): android.app.Notification =
    NotificationCompat.Builder(this, SERVICE_CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_notification_terminal)
      .setContentTitle("Terminal")
      .setContentText(if (connected) "Connected" else "Not connected")
      .setContentIntent(launchIntent())
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .build()

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
  }

  companion object {
    private const val ACTION_START = "expo.modules.mobilyforeground.START"
    private const val ACTION_UPDATE = "expo.modules.mobilyforeground.UPDATE"
    private const val EXTRA_CONNECTED = "connected"
    private const val SERVICE_CHANNEL_ID = "mobily-terminal-session"
    private const val SERVICE_NOTIFICATION_ID = 7011

    fun start(context: Context) {
      val intent = Intent(context, MobilyForegroundService::class.java)
        .setAction(ACTION_START)
      ContextCompat.startForegroundService(context, intent)
    }

    fun update(context: Context, connected: Boolean) {
      val intent = Intent(context, MobilyForegroundService::class.java)
        .setAction(ACTION_UPDATE)
        .putExtra(EXTRA_CONNECTED, connected)
      context.startService(intent)
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, MobilyForegroundService::class.java))
    }
  }
}
