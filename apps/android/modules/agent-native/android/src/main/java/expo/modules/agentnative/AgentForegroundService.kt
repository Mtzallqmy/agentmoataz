package expo.modules.agentnative

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat

/**
 * Keeps the application process in foreground while an agent run is active.
 * Authoritative run/task state remains in SQLite; this service only owns the
 * Android foreground lifecycle, notification, and an active-run wake lock.
 */
class AgentForegroundService : Service() {
  companion object {
    const val CHANNEL_ID = "agent_runs"
    const val NOTIFICATION_ID = 4217
    const val EXTRA_RUN_ID = "runId"
    const val EXTRA_STATE = "state"
    const val ACTION_START = "dev.agentmoataz.action.START_RUN"
    const val ACTION_UPDATE = "dev.agentmoataz.action.UPDATE_RUN"
    const val ACTION_STOP = "dev.agentmoataz.action.STOP_RUN"
  }

  private var runId: String? = null
  private var state: String = "Running"
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onCreate() {
    super.onCreate()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Agent runs",
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = "Long-running AgentMoataz tasks"
      }
      getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> {
        runId = intent.getStringExtra(EXTRA_RUN_ID)
        state = "Running"
        acquireWakeLock()
        startForeground(NOTIFICATION_ID, buildNotification())
      }
      ACTION_UPDATE -> {
        state = intent.getStringExtra(EXTRA_STATE)?.takeIf { it.isNotBlank() } ?: state
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification())
      }
      ACTION_STOP -> stopRunService()
      else -> {
        // Never resurrect a stale run after process death. SQLite recovery in
        // the JS runtime marks unfinished work as interrupted on next launch.
        releaseWakeLock()
        stopSelf()
      }
    }
    return START_NOT_STICKY
  }

  private fun acquireWakeLock() {
    val current = wakeLock
    if (current?.isHeld == true) return
    val powerManager = getSystemService(PowerManager::class.java)
    wakeLock = powerManager.newWakeLock(
      PowerManager.PARTIAL_WAKE_LOCK,
      "$packageName:AgentRun"
    ).apply {
      setReferenceCounted(false)
      acquire()
    }
  }

  private fun stopRunService() {
    releaseWakeLock()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE)
    else @Suppress("DEPRECATION") stopForeground(true)
    stopSelf()
  }

  private fun releaseWakeLock() {
    wakeLock?.let { lock ->
      if (lock.isHeld) lock.release()
    }
    wakeLock = null
  }

  private fun buildNotification(): Notification {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName) ?: Intent(this, application.javaClass)
    val contentIntent = PendingIntent.getActivity(
      this,
      0,
      launchIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val suffix = runId?.takeLast(8)?.let { " · $it" } ?: ""
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("AgentMoataz")
      .setContentText("$state$suffix")
      .setSmallIcon(android.R.drawable.stat_notify_sync)
      .setContentIntent(contentIntent)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .build()
  }

  override fun onDestroy() {
    releaseWakeLock()
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null
}
