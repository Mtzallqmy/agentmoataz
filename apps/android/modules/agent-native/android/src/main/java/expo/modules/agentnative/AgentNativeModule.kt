package expo.modules.agentnative

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AgentNativeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AgentNative")

    AsyncFunction("start") { runId: String ->
      val context = requireContext()
      val intent = Intent(context, AgentForegroundService::class.java).apply {
        action = AgentForegroundService.ACTION_START
        putExtra(AgentForegroundService.EXTRA_RUN_ID, runId)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
      else context.startService(intent)
    }

    AsyncFunction("updateState") { state: String ->
      val context = requireContext()
      val intent = Intent(context, AgentForegroundService::class.java).apply {
        action = AgentForegroundService.ACTION_UPDATE
        putExtra(AgentForegroundService.EXTRA_STATE, state)
      }
      context.startService(intent)
    }

    AsyncFunction("stop") {
      val context = requireContext()
      val intent = Intent(context, AgentForegroundService::class.java).apply {
        action = AgentForegroundService.ACTION_STOP
      }
      context.startService(intent)
    }

    Function("isIgnoringBatteryOptimizations") {
      val context = requireContext()
      val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      powerManager.isIgnoringBatteryOptimizations(context.packageName)
    }
  }

  private fun requireContext(): Context =
    appContext.reactContext ?: throw IllegalStateException("React context is not available")
}
