import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Button, Card, Field, Screen, Title, ui } from "../components/AppUI";
import { useProjects } from "../services/AppAgentContext";

export default function Projects() {
  const router = useRouter(); const { projects, loading, createProject } = useProjects(); const [name, setName] = useState("");
  return <Screen><Title hint="Projects and workspaces persist in SQLite + app storage">Projects</Title><View style={ui.row}><Field style={{ flex: 1 }} value={name} onChangeText={setName} placeholder="Project name" /><Button title="Create" onPress={() => void createProject(name).then(() => setName(""))} /></View>{loading ? <Text style={ui.muted}>Loading…</Text> : projects.map((project) => <Pressable key={project.id} onPress={() => router.push({ pathname: "/chat", params: { projectId: project.id } })}><Card><Text style={ui.heading}>{project.name}</Text><Text style={ui.muted}>{project.id}</Text><View style={ui.row}><Button tone="muted" title="Files" onPress={() => router.push({ pathname: "/files", params: { projectId: project.id } })} /><Button title="Run task" onPress={() => router.push({ pathname: "/chat", params: { projectId: project.id } })} /></View></Card></Pressable>)}</Screen>;
}
