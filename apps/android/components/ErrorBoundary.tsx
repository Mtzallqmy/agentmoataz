import React from "react";
import { View, Text, StyleSheet } from "react-native";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  message?: string;
}

/** App-level error boundary. Raw crashes must never surface as blank screens. */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error) {
    // structured log hook (agent category) — no secrets
    console.log(JSON.stringify({ category: "ui", level: "error", message: error.message }));
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.wrap}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.msg}>{this.state.message ?? "Unknown error"}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#0f1115", padding: 24 },
  title: { color: "#fff", fontSize: 18, fontWeight: "700" },
  msg: { color: "#9aa3b2", marginTop: 8, textAlign: "center" },
});
