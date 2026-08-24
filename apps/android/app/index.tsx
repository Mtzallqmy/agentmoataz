import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Card, Screen, Title, ui } from "../components/AppUI";
import { useAgentRuntime, useProjects } from "../services/AppAgentContext";

const links = [
  ["New task", "/chat", "Start a model-driven run"], ["Projects", "/projects", "Workspaces and history"],
  ["Tasks", "/tasks", "Live and interrupted runs"], ["Files", "/files", "Browse and edit files"],
  ["Artifacts", "/artifacts", "ZIP exports and reports"], ["Models", "/models", "Configure a real provider"],
  ["Tools", "/tools", "Built-ins and MCP"], ["Memory", "/memory", "Inspect persisted memory"],
  ["Skills", "/skills", "Reusable workflows"], ["Settings", "/settings", "Permissions and runtime"],
] as const;

export default function Home() {
  const router = useRouter();
  const { snapshot } = useAgentRuntime();
  const { projects } = useProjects();
  return <Screen>
    <Title hint="Local-first autonomous coding agent">AgentMoataz</Title>
    <Card><Text style={ui.heading}>Runtime status</Text><Text style={snapshot.providerConfigured ? ui.good : ui.bad}>{snapshot.providerConfigured ? "Real provider configured" : "Provider required before running tasks"}</Text><Text style={ui.muted}>{projects.length} local project(s) · {snapshot.activeRunId ? "run active" : "idle"}</Text></Card>
    <View style={styles.grid}>{links.map(([title, route, hint]) => <Pressable key={route} style={styles.link} onPress={() => router.push(route as never)}><Text style={styles.linkTitle}>{title}</Text><Text style={styles.linkHint}>{hint}</Text></Pressable>)}</View>
  </Screen>;
}

const styles = StyleSheet.create({ grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, link: { width: "48%", minHeight: 92, backgroundColor: "#171c26", borderRadius: 12, padding: 13, borderWidth: 1, borderColor: "#283142", justifyContent: "center" }, linkTitle: { color: "#fff", fontWeight: "700", fontSize: 16 }, linkHint: { color: "#7f899b", fontSize: 11, marginTop: 4 } });
