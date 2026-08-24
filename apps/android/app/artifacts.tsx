import React from "react";
import { Text, View } from "react-native";
import { Button, Card, Screen, Title, ui } from "../components/AppUI";
import { useArtifacts, useProjects } from "../services/AppAgentContext";

export default function Artifacts() { const { projects } = useProjects(); const { artifacts, refresh, exportProject } = useArtifacts(projects[0]?.id ?? null); return <Screen><Title hint="ZIP exports and generated reports remain local">Artifacts</Title><View style={ui.row}><Button title="Export project ZIP" onPress={() => void exportProject()} disabled={!projects.length} /><Button tone="muted" title="Refresh" onPress={() => void refresh()} /></View>{artifacts.map((artifact) => <Card key={artifact.id}><Text style={ui.heading}>{artifact.path.split("/").pop()}</Text><Text style={ui.body}>{artifact.type} · {artifact.sizeBytes} bytes</Text><Text style={ui.muted}>{artifact.path}</Text></Card>)}{!artifacts.length ? <Text style={ui.muted}>No artifacts yet.</Text> : null}</Screen>; }
