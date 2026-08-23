import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";

const SECTIONS: Array<{ title: string; route: string; hint: string }> = [
  { title: "New Task", route: "/chat", hint: "Start an agent run" },
  { title: "Projects", route: "/projects", hint: "Workspaces & history" },
  { title: "Tasks", route: "/tasks", hint: "Live run timeline" },
  { title: "Files", route: "/files", hint: "Browse project files" },
  { title: "Artifacts", route: "/artifacts", hint: "ZIPs, reports, exports" },
  { title: "Models", route: "/models", hint: "Providers & routing" },
  { title: "Tools", route: "/tools", hint: "Built-ins & MCP" },
  { title: "Memory", route: "/memory", hint: "Inspect stored memory" },
  { title: "Skills", route: "/skills", hint: "Enable/disable skills" },
  { title: "Settings", route: "/settings", hint: "Permissions & cloud" },
];

export default function Home() {
  const router = useRouter();
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>AgentMoataz</Text>
      <Text style={styles.subtitle}>Local-first autonomous AI agent</Text>
      <View style={styles.grid}>
        {SECTIONS.map((s) => (
          <Pressable key={s.route} style={styles.card} onPress={() => router.push(s.route as never)}>
            <Text style={styles.cardTitle}>{s.title}</Text>
            <Text style={styles.cardHint}>{s.hint}</Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f1115" },
  content: { padding: 16, paddingBottom: 40 },
  title: { color: "#fff", fontSize: 28, fontWeight: "700", marginTop: 12 },
  subtitle: { color: "#9aa3b2", fontSize: 14, marginBottom: 20 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  card: {
    width: "47%",
    backgroundColor: "#1a1e27",
    borderRadius: 12,
    padding: 14,
    minHeight: 84,
    justifyContent: "center",
  },
  cardTitle: { color: "#fff", fontSize: 16, fontWeight: "600" },
  cardHint: { color: "#8b93a3", fontSize: 12, marginTop: 4 },
});
