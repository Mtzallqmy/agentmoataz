import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import type { AgentEvent } from "@agentmoataz/agent-protocol";

export function Screen({ children }: { children: React.ReactNode }) {
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>{children}</ScrollView>;
}

export function Title({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return <View style={styles.titleBlock}><Text style={styles.title}>{children}</Text>{hint ? <Text style={styles.hint}>{hint}</Text> : null}</View>;
}

export function Field(props: TextInputProps) {
  return <TextInput placeholderTextColor="#6f7a8c" {...props} style={[styles.field, props.multiline && styles.multiline, props.style]} />;
}

export function Button({ title, onPress, tone = "primary", disabled = false }: { title: string; onPress: () => void; tone?: "primary" | "danger" | "muted"; disabled?: boolean }) {
  return <Pressable disabled={disabled} onPress={onPress} style={[styles.button, styles[`${tone}Button`], disabled && styles.disabled]}><Text style={styles.buttonText}>{title}</Text></Pressable>;
}

export function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function EventTimeline({ events }: { events: readonly AgentEvent[] }) {
  if (!events.length) return <Text style={styles.empty}>No execution events yet.</Text>;
  return <View style={styles.timeline}>{events.slice(-100).map((event) => <View key={event.id} style={styles.event}><View style={styles.dot} /><View style={styles.eventBody}><Text style={styles.eventType}>{event.type.replaceAll("_", " ")}</Text><Text numberOfLines={4} style={styles.eventPayload}>{JSON.stringify(event.payload)}</Text></View></View>)}</View>;
}

export const ui = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  label: { color: "#a7b0c0", fontSize: 12, marginTop: 8, marginBottom: 4 },
  body: { color: "#d8deea", lineHeight: 20 },
  muted: { color: "#7f899b" },
  good: { color: "#43d39e" },
  bad: { color: "#ff7d85" },
  heading: { color: "#fff", fontWeight: "700", fontSize: 16, marginBottom: 8 },
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0d1016" },
  content: { padding: 18, paddingBottom: 64, gap: 12 },
  titleBlock: { marginBottom: 8 },
  title: { color: "#f7f9fc", fontSize: 27, fontWeight: "800", letterSpacing: -0.5 },
  hint: { color: "#8d97a8", marginTop: 4, lineHeight: 19 },
  field: { color: "#f5f7fb", backgroundColor: "#171c26", borderWidth: 1, borderColor: "#2a3241", borderRadius: 10, paddingHorizontal: 12, minHeight: 46 },
  multiline: { minHeight: 110, paddingTop: 12, textAlignVertical: "top" },
  button: { minHeight: 42, borderRadius: 9, paddingHorizontal: 15, alignItems: "center", justifyContent: "center" },
  primaryButton: { backgroundColor: "#4169e1" },
  dangerButton: { backgroundColor: "#9f3440" },
  mutedButton: { backgroundColor: "#293140" },
  disabled: { opacity: 0.45 },
  buttonText: { color: "#fff", fontWeight: "700" },
  card: { backgroundColor: "#161b24", borderColor: "#272f3d", borderWidth: 1, borderRadius: 12, padding: 14 },
  empty: { color: "#778296", fontStyle: "italic", paddingVertical: 12 },
  timeline: { gap: 0 },
  event: { flexDirection: "row", gap: 10, minHeight: 58 },
  dot: { width: 9, height: 9, borderRadius: 9, backgroundColor: "#6f8cff", marginTop: 6 },
  eventBody: { flex: 1, borderLeftWidth: 1, borderLeftColor: "#273040", paddingLeft: 11, paddingBottom: 12 },
  eventType: { color: "#e7ebf3", fontWeight: "700", textTransform: "capitalize" },
  eventPayload: { color: "#7f8a9e", fontSize: 11, marginTop: 3 },
});
