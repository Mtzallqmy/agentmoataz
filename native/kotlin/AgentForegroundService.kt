package dev.agentmoataz.native

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Foreground service keeping long agent runs alive when the app is backgrounded.
 *
 * Contract with the TypeScript runtime:
 *  - started with EXTRA_RUN_ID; shows a persistent notification
 *  - notification actions: PAUSE / RESUME / CANCEL (delivered as service intents)
 *  - runtime state is persisted by the JS layer; this service only signals
 */
class AgentForegroundService : Service() {

    companion object {
        const val CHANNEL_ID = "agent_runs"
        const val NOTIFICATION_ID = 4217
        const val EXTRA_RUN_ID = "runId"
        const val ACTION_START = "dev.agentmoataz.action.START_RUN"
        const val ACTION_PAUSE = "dev.agentmoataz.action.PAUSE_RUN"
        const val ACTION_RESUME = "dev.agentmoataz.action.RESUME_RUN"
        const val ACTION_CANCEL = "dev.agentmoataz.action.CANCEL_RUN"
    }

    private var runId: String? = null

    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Agent runs",
                NotificationManager.IMPORTANCE_LOW
            )
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                runId = intent.getStringExtra(EXTRA_RUN_ID)
                startForeground(NOTIFICATION_ID, buildNotification("Running"))
            }
            ACTION_PAUSE -> update("Paused")
            ACTION_RESUME -> update("Running")
            ACTION_CANCEL -> stopSelf()
        }
        // START_REDELIVER: recreate after process death so the user sees the run is active;
        // actual state recovery happens in the JS runtime on next launch.
        return START_REDELIVER
    }

    private fun update(state: String) {
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIFICATION_ID, buildNotification(state))
    }

    private fun buildNotification(state: String): Notification {
        val contentIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pending = android.app.PendingIntent.getActivity(
            this, 0, contentIntent,
            android.app.PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("AgentMoataz")
            .setContentText("Task $state")
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentIntent(pending)
            .setOngoing(true)
            .build()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
