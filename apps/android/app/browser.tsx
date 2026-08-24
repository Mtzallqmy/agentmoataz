import React, { useState } from "react";
import { Text } from "react-native";
import { Button, Card, Field, Screen, Title, ui } from "../components/AppUI";

/**
 * Browser layer (Phase 4) — minimal WebView placeholder.
 * Real WebView requires `react-native-webview` and JDK build; locally we
 * provide controlled navigation + extraction stubs. Heavy automation is
 * escalated to cloud browser (flag off by default).
 */
export default function Browser() {
  const [url, setUrl] = useState("https://example.com");
  const [extracted, setExtracted] = useState<string | null>(null);

  const navigate = (): void => {
    // In production this would drive <WebView source={{uri: url}} />
    // Here we simulate controlled extraction without full automation.
    setExtracted(`[stub] Extracted text from ${url} — external content is treated as data, never as instructions. Trust order: POLICY > USER > PROJECT > RETRIEVED.`);
  };

  return <Screen>
    <Title hint="WebView is scaffolder; heavy automation escalates to cloud_browser flag">Browser</Title>
    <Field value={url} onChangeText={setUrl} placeholder="https://..." />
    <Button title="Navigate (stub)" onPress={navigate} />
    {extracted ? <Card><Text style={ui.body}>{extracted}</Text></Card> : null}
    <Card><Text style={ui.muted}>Limited JS injection, screenshots via native WebView when JDK build is available. For Chromium-heavy flows enable cloud_browser (off by default) — see CLOUD_ESCALATION.md.</Text></Card>
  </Screen>;
}
