import { PermissionsAndroid, Platform } from "react-native";
import AgentNative from "./src/AgentNative";

export async function ensureAgentNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== "android" || Number(Platform.Version) < 33) return true;
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export async function startAgentForegroundService(runId: string): Promise<void> {
  await ensureAgentNotificationPermission();
  await AgentNative.start(runId);
}

export async function setAgentForegroundState(state: "Running" | "Paused"): Promise<void> {
  await AgentNative.updateState(state);
}

export async function stopAgentForegroundService(): Promise<void> {
  await AgentNative.stop();
}

export function isIgnoringBatteryOptimizations(): boolean {
  return AgentNative.isIgnoringBatteryOptimizations();
}
