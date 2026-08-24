import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import type { MemoryRecord } from "@agentmoataz/agent-protocol";
import { Button, Card, Field, Screen, Title, ui } from "../components/AppUI";
import { useAgentRuntime } from "../services/AppAgentContext";

export default function Memory() {
  const { runtime, snapshot } = useAgentRuntime();
  const [items, setItems] = useState<MemoryRecord[]>([]);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const refresh = async () => setItems(await runtime.memory?.listAll() ?? []);
  useEffect(() => { if (snapshot.initialized) void refresh(); }, [snapshot.initialized]);

  const save = async () => {
    const content = draft.trim();
    if (!content || !runtime.memory) return;
    if (editingId) await runtime.memory.updateContent(editingId, content);
    else await runtime.memory.remember({ scope: "project", content });
    setDraft("");
    setEditingId(null);
    await refresh();
  };

  return <Screen>
    <Title hint="Inspectable, editable, disableable and deletable local memory">Memory</Title>
    <View style={ui.row}>
      <Field style={{ flex: 1 }} value={draft} onChangeText={setDraft} placeholder={editingId ? "Edit memory" : "Remember a project fact"} />
      <Button title={editingId ? "Save" : "Add"} disabled={!draft.trim()} onPress={() => void save()} />
      {editingId ? <Button tone="muted" title="Cancel" onPress={() => { setEditingId(null); setDraft(""); }} /> : null}
    </View>
    {items.map((item) => <Card key={item.id}>
      <Text style={item.enabled ? ui.body : ui.muted}>{item.content}</Text>
      <Text style={ui.muted}>{item.scope} · confidence {item.confidence} · {item.enabled ? "enabled" : "disabled"}</Text>
      <View style={ui.row}>
        <Button tone="muted" title="Edit" onPress={() => { setEditingId(item.id); setDraft(item.content); }} />
        <Button tone="muted" title={item.enabled ? "Disable" : "Enable"} onPress={() => void runtime.memory?.setEnabled(item.id, !item.enabled).then(refresh)} />
        <Button tone="danger" title="Delete" onPress={() => void runtime.memory?.forget(item.id).then(refresh)} />
      </View>
    </Card>)}
    {!items.length ? <Text style={ui.muted}>No saved memory yet.</Text> : null}
  </Screen>;
}
