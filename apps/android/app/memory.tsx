import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import type { MemoryRecord } from "@agentmoataz/agent-protocol";
import { Button, Card, Field, Screen, Title, ui } from "../components/AppUI";
import { useAgentRuntime } from "../services/AppAgentContext";

export default function Memory() { const { runtime, snapshot } = useAgentRuntime(); const [items, setItems] = useState<MemoryRecord[]>([]); const [draft, setDraft] = useState(""); const refresh = async () => setItems(await runtime.memory?.listAll() ?? []); useEffect(() => { if (snapshot.initialized) void refresh(); }, [snapshot.initialized]); return <Screen><Title hint="Inspectable, editable and deletable local memory">Memory</Title><View style={ui.row}><Field style={{ flex: 1 }} value={draft} onChangeText={setDraft} placeholder="Remember a project fact" /><Button title="Add" onPress={() => void runtime.memory?.remember({ scope: "project", content: draft }).then(() => { setDraft(""); return refresh(); })} /></View>{items.map((item) => <Card key={item.id}><Text style={ui.body}>{item.content}</Text><Text style={ui.muted}>{item.scope} · confidence {item.confidence}</Text><Button tone="danger" title="Delete" onPress={() => void runtime.memory?.forget(item.id).then(refresh)} /></Card>)}</Screen>; }
