import React from "react";
import { Text } from "react-native";
import { Card, EventTimeline, Screen, Title, ui } from "../components/AppUI";
import { useRun, useRuns } from "../services/AppAgentContext";

export default function Tasks() { const { activeRunId, paused, events, error } = useRun(); const { runs } = useRuns(); return <Screen><Title hint="Persisted execution state, never inferred from prose">Tasks</Title><Card><Text style={activeRunId ? ui.good : ui.muted}>{activeRunId ? `${paused ? "Paused" : "Running"}: ${activeRunId}` : "No active run"}</Text>{error ? <Text style={ui.bad}>{error.code}: {error.message}</Text> : null}</Card>{runs.map((run) => <Card key={run.id}><Text style={ui.heading}>{run.goal}</Text><Text style={run.state === "completed" ? ui.good : run.state === "failed" ? ui.bad : ui.body}>{run.state} · {run.stepsTaken}/{run.maxSteps} turns</Text><Text style={ui.muted}>{run.updatedAt}</Text></Card>)}<Text style={ui.heading}>Latest event stream</Text><EventTimeline events={events} /></Screen>; }
