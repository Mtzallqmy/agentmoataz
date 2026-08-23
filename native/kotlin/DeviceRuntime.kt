package dev.agentmoataz.native

import android.content.Context
import android.os.PowerManager

/**
 * Lifecycle & recovery helpers.
 *
 * On app start the JS runtime inspects persisted runs; these helpers give it
 * the device-side facts it needs to reconcile interrupted work:
 *  - was the process killed while a foreground service held a wake lock
 *  - battery-saver / Doze restrictions that may have throttled runs
 */
object DeviceRuntime {

    fun isIgnoringBatteryOptimizations(context: Context): Boolean {
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        return pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    /**
     * True when the previous process ended abnormally (crash or kill).
     * The JS layer combines this with persisted run state: runs found in
     * running/planning/waiting_approval are marked `interrupted` and offered
     * for safe resume — destructive steps are never silently repeated.
     */
    fun lastExitWasAbnormal(expectedPidFileLastSeen: Long, nowMs: Long): Boolean {
        // heartbeat older than 90s at startup implies abnormal end
        return nowMs - expectedPidFileLastSeen > 90_000
    }
}
