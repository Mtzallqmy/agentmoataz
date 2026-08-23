import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ErrorBoundary } from "../components/ErrorBoundary";

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerTitleStyle: { fontWeight: "600" } }}>
        <Stack.Screen name="index" options={{ title: "AgentMoataz" }} />
        <Stack.Screen name="chat" options={{ title: "Run" }} />
        <Stack.Screen name="projects" options={{ title: "Projects" }} />
        <Stack.Screen name="tasks" options={{ title: "Tasks" }} />
        <Stack.Screen name="files" options={{ title: "Files" }} />
        <Stack.Screen name="artifacts" options={{ title: "Artifacts" }} />
        <Stack.Screen name="models" options={{ title: "Models" }} />
        <Stack.Screen name="tools" options={{ title: "Tools" }} />
        <Stack.Screen name="memory" options={{ title: "Memory" }} />
        <Stack.Screen name="skills" options={{ title: "Skills" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
      </Stack>
    </ErrorBoundary>
  );
}
