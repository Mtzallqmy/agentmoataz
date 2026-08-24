import { PermissionsAndroid, Platform } from "react-native";
import AgentNative from "./src/AgentNative";

export async function ensureAgentNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== "android" || Number(Platform.Version) < 33) return true;
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

/** Foreground service is a reliability enhancement; a native failure must not corrupt the run state. */
export async function startAgentForegroundService(runId: string): Promise<boolean> {
  try {
    await ensureAgentNotificationPermission();
    await AgentNative.start(runId);
    return true;
  } catch {
    return false;
  }
}

export async function setAgentForegroundState(state: "Running" | "Paused"): Promise<boolean> {
  try {
    await AgentNative.updateState(state);
    return true;
  } catch {
    return false;
  }
}

export async function stopAgentForegroundService(): Promise<boolean> {
  try {
    await AgentNative.stop();
    return true;
  } catch {
    return false;
  }
}

export function isIgnoringBatteryOptimizations(): boolean {
  try {
    return AgentNative.isIgnoringBatteryOptimizations();
  } catch {
    return false;
  }
}
