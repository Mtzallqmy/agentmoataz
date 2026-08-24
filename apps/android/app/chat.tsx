import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Button, Card, EventTimeline, Field, Screen, Title, ui } from "../components/AppUI";
import { useApprovals, useProjects, useRun } from "../services/AppAgentContext";

export default function ChatRun() {
  const params = useLocalSearchParams<{ projectId?: string; goal?: string }>();
  const { projects, createProject } = useProjects();
  const { runtime, activeRunId, paused, events, error } = useRun();
  const { pendingApproval, approve, deny } = useApprovals();
  const [goal, setGoal] = useState(params.goal ?? "");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof params.goal === "string" && params.goal && !busy && !activeRunId) setGoal(params.goal);
  }, [params.goal, busy, activeRunId]);

  const run = async () => {
    if (!goal.trim() || busy || activeRunId) return;
    setBusy(true);
    setAnswer("");
    try {
      const project = params.projectId ?? projects[0]?.id ?? (await createProject("My project")).id;
      const result = await runtime.runGoal(project, goal.trim());
      setAnswer(result.text || result.error?.message || result.state);
    } catch (cause) {
      setAnswer(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return <Screen>
    <Title hint="The model chooses tools; state changes appear below">Run agent</Title>
    <Field multiline value={goal} onChangeText={setGoal} placeholder="Describe what to build or change…" />
    <View style={ui.row}>
      <Button
        title={activeRunId ? "Another run is active" : busy ? "Running…" : "Run goal"}
        onPress={() => void run()}
        disabled={busy || Boolean(activeRunId) || !goal.trim()}
      />
      {activeRunId ? <>
        <Button tone="muted" title={paused ? "Resume" : "Pause"} onPress={() => paused ? runtime.resume() : runtime.pause()} />
        <Button tone="danger" title="Cancel" onPress={() => runtime.cancel()} />
      </> : null}
    </View>
    {pendingApproval ? <Card>
      <Text style={ui.heading}>Approval required</Text>
      <Text style={ui.body}>{pendingApproval.toolName} · {pendingApproval.permissionCategory}</Text>
      <View style={ui.row}>
        <Button title="Approve once" onPress={approve} />
        <Button tone="danger" title="Deny" onPress={deny} />
      </View>
    </Card> : null}
    {answer ? <Card><Text style={ui.heading}>Model response</Text><Text style={ui.body}>{answer}</Text></Card> : null}
    {error ? <Card><Text style={ui.bad}>{error.code}: {error.message}</Text></Card> : null}
    <PlanView events={events} />
    <ArtifactsView events={events} />
    <Text style={ui.heading}>Execution timeline</Text>
    <EventTimeline events={events} />
  </Screen>;
}

function PlanView({ events }: { events: ReturnType<typeof useRun>["events"] }) {
  const plans = events.filter((e) => e.type === "plan_updated");
  const stepsStarted = events.filter((e) => e.type === "step_started");
  const stepsDone = new Set(events.filter((e) => e.type === "step_completed").map((e) => e.stepId));
  const stepsFailed = new Set(events.filter((e) => e.type === "step_failed").map((e) => e.stepId));
  if (plans.length === 0 && stepsStarted.length === 0) return null;
  return <Card>
    <Text style={ui.heading}>Plan & Steps</Text>
    {plans.map((p) => <Text key={p.id} style={ui.body}>Plan: {JSON.stringify((p.payload as { steps?: unknown }).steps ?? p.payload)}</Text>)}
    {stepsStarted.map((s) => {
      const sid = s.stepId ?? "";
      const status = stepsFailed.has(sid) ? "failed" : stepsDone.has(sid) ? "completed" : "running";
      const color = status === "failed" ? ui.bad : status === "completed" ? ui.good : ui.body;
      return <Text key={s.id} style={color}>• {(s.payload as { title?: string }).title ?? sid} — {status}</Text>;
    })}
    <Text style={ui.muted}>{stepsStarted.length} steps, {stepsDone.size} completed, {stepsFailed.size} failed</Text>
  </Card>;
}

function ArtifactsView({ events }: { events: ReturnType<typeof useRun>["events"] }) {
  const arts = events.filter((e) => e.type === "artifact_created");
  if (arts.length === 0) return null;
  return <Card><Text style={ui.heading}>Artifacts</Text>{arts.map((a) => <Text key={a.id} style={ui.body}>{JSON.stringify(a.payload)}</Text>)}</Card>;
}
