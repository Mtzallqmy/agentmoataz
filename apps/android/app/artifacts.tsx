import React from "react";
import { View, Text, StyleSheet } from "react-native";

export default function Screen() {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>artifacts</Text>
      <Text style={styles.hint}>Screen scaffolded in Phase 3; wired to agent runtime events as phases land.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#0f1115", padding: 20 },
  title: { color: "#fff", fontSize: 24, fontWeight: "700" },
  hint: { color: "#9aa3b2", marginTop: 8 },
});
