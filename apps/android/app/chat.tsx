import React, { useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Button, Card, EventTimeline, Field, Screen, Title, ui } from "../components/AppUI";
import { useApprovals, useProjects, useRun } from "../services/AppAgentContext";

export default function ChatRun() {
  const params = useLocalSearchParams<{ projectId?: string }>();
  const { projects, createProject } = useProjects();
  const { runtime, activeRunId, paused, events, error } = useRun();
  const { pendingApproval, approve, deny } = useApprovals();
  const [goal, setGoal] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!goal.trim() || busy) return;
    setBusy(true); setAnswer("");
    try {
      const project = params.projectId ?? projects[0]?.id ?? (await createProject("My project")).id;
      const result = await runtime.runGoal(project, goal.trim());
      setAnswer(result.text || result.error?.message || result.state);
    } catch (cause) { setAnswer(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <Screen>
    <Title hint="The model chooses tools; state changes appear below">Run agent</Title>
    <Field multiline value={goal} onChangeText={setGoal} placeholder="Describe what to build or change…" />
    <View style={ui.row}><Button title={busy ? "Running…" : "Run goal"} onPress={() => void run()} disabled={busy || !goal.trim()} />{activeRunId ? <><Button tone="muted" title={paused ? "Resume" : "Pause"} onPress={() => paused ? runtime.resume() : runtime.pause()} /><Button tone="danger" title="Cancel" onPress={() => runtime.cancel()} /></> : null}</View>
    {pendingApproval ? <Card><Text style={ui.heading}>Approval required</Text><Text style={ui.body}>{pendingApproval.toolName} · {pendingApproval.permissionCategory}</Text><View style={ui.row}><Button title="Approve once" onPress={approve} /><Button tone="danger" title="Deny" onPress={deny} /></View></Card> : null}
    {answer ? <Card><Text style={ui.heading}>Model response</Text><Text style={ui.body}>{answer}</Text></Card> : null}
    {error ? <Card><Text style={ui.bad}>{error.code}: {error.message}</Text></Card> : null}
    <Text style={ui.heading}>Execution timeline</Text><EventTimeline events={events} />
  </Screen>;
}
