import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Button, Card, Field, Screen, Title, ui } from "../components/AppUI";
import { useAgentRuntime, useProjects } from "../services/AppAgentContext";

export default function Files() {
  const params = useLocalSearchParams<{ projectId?: string }>(); const { runtime, snapshot } = useAgentRuntime(); const { projects } = useProjects();
  const projectId = params.projectId ?? projects[0]?.id ?? null; const [files, setFiles] = useState<Array<{ relativePath: string; isDirectory: boolean }>>([]); const [selected, setSelected] = useState(""); const [content, setContent] = useState(""); const [status, setStatus] = useState("");
  const refresh = async () => { if (projectId) setFiles(await runtime.listFiles(projectId)); };
  useEffect(() => { if (snapshot.initialized && projectId) void refresh(); }, [snapshot.initialized, projectId]);
  const open = async (path: string) => { if (!projectId) return; setSelected(path); setContent(await runtime.readFile(projectId, path)); };
  return <Screen><Title hint={projectId ? `Project ${projectId}` : "Create a project first"}>Files</Title><View style={ui.row}><Button tone="muted" title="Refresh" onPress={() => void refresh()} />{selected ? <Button title="Save" onPress={() => projectId ? void runtime.writeFile(projectId, selected, content).then(() => setStatus("Saved")) : undefined} /> : null}</View>{files.filter((file) => !file.isDirectory).map((file) => <Pressable key={file.relativePath} onPress={() => void open(file.relativePath)}><Card><Text style={ui.body}>{file.relativePath}</Text></Card></Pressable>)}{selected ? <><Text style={ui.heading}>{selected}</Text><Field multiline value={content} onChangeText={setContent} />{status ? <Text style={ui.good}>{status}</Text> : null}</> : null}</Screen>;
}
