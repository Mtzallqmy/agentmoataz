import React from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Button, Card, Screen, Title, ui } from "../components/AppUI";
import { useArtifacts, useProjects } from "../services/AppAgentContext";

export default function Artifacts() {
  const params = useLocalSearchParams<{ projectId?: string }>();
  const { projects } = useProjects();
  const projectId = params.projectId ?? projects[0]?.id ?? null;
  const project = projects.find((item) => item.id === projectId);
  const { artifacts, refresh, exportProject } = useArtifacts(projectId);

  return <Screen>
    <Title hint={project ? `Local artifacts for ${project.name}` : "Create a project first"}>Artifacts</Title>
    <View style={ui.row}>
      <Button title="Export project ZIP" onPress={() => void exportProject()} disabled={!projectId} />
      <Button tone="muted" title="Refresh" onPress={() => void refresh()} disabled={!projectId} />
    </View>
    {artifacts.map((artifact) => <Card key={artifact.id}>
      <Text style={ui.heading}>{artifact.path.split("/").pop()}</Text>
      <Text style={ui.body}>{artifact.type} · {artifact.sizeBytes} bytes</Text>
      {artifact.checksumSha256 ? <Text style={ui.muted}>SHA-256: {artifact.checksumSha256}</Text> : null}
      <Text style={ui.muted}>{artifact.path}</Text>
    </Card>)}
    {!artifacts.length ? <Text style={ui.muted}>No artifacts yet.</Text> : null}
  </Screen>;
}
