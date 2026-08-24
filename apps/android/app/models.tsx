import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Button, Card, Field, Screen, Title, ui } from "../components/AppUI";
import { useProviderSettings } from "../services/AppAgentContext";

export default function Models() {
  const provider = useProviderSettings();
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1/");
  const [modelId, setModelId] = useState("");
  const [displayName, setDisplayName] = useState("OpenAI-compatible");
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => { if (provider.settings) { setBaseUrl(provider.settings.baseUrl); setModelId(provider.settings.modelId); setDisplayName(provider.settings.displayName); } }, [provider.settings]);
  const save = async () => { try { await provider.save({ baseUrl, modelId, displayName, secretRef: "provider-primary", enabled: true, priority: 100 }, apiKey); setApiKey(""); setStatus("Saved securely"); } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); } };
  return <Screen><Title hint="API keys are stored in SecureStore, never SQLite">Model provider</Title><Card><Text style={provider.configured ? ui.good : ui.bad}>{provider.configured ? "Configured" : "No real provider configured"}</Text></Card><Text style={ui.label}>Display name</Text><Field value={displayName} onChangeText={setDisplayName} /><Text style={ui.label}>Base URL</Text><Field autoCapitalize="none" value={baseUrl} onChangeText={setBaseUrl} /><Text style={ui.label}>Model ID</Text><Field autoCapitalize="none" value={modelId} onChangeText={setModelId} /><Text style={ui.label}>API key</Text><Field secureTextEntry autoCapitalize="none" value={apiKey} onChangeText={setApiKey} placeholder={provider.configured ? "Leave blank only if replacing config with same key" : "Required"} /><View style={ui.row}><Button title="Save" onPress={() => void save()} disabled={!baseUrl || !modelId || (!apiKey && !provider.configured)} /><Button tone="muted" title="Test connection" onPress={() => void provider.test().then((text) => setStatus(`Connected: ${text}`)).catch((error) => setStatus(error.message))} /><Button tone="danger" title="Remove" onPress={() => void provider.remove()} /></View>{status ? <Text style={ui.body}>{status}</Text> : null}</Screen>;
}
