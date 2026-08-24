import React, { useState } from "react";
import { Text } from "react-native";
import { Button, Card, Screen, Title, ui } from "../components/AppUI";
import { useAgentRuntime } from "../services/AppAgentContext";

export default function Skills() { const { runtime } = useAgentRuntime(); const [, redraw] = useState(0); const skills = runtime.skills.list(); return <Screen><Title hint="Skills constrain tools but never bypass permissions">Skills</Title>{skills.map((skill) => <Card key={skill.record.name}><Text style={ui.heading}>{skill.record.name}</Text><Text style={ui.body}>{skill.record.purpose}</Text><Text style={ui.muted}>{skill.record.allowedTools.join(", ")}</Text><Button tone={skill.record.enabled ? "primary" : "muted"} title={skill.record.enabled ? "Enabled" : "Disabled"} onPress={() => { runtime.skills.setEnabled(skill.record.name, !skill.record.enabled); redraw((value) => value + 1); }} /></Card>)}{!skills.length ? <Text style={ui.muted}>No bundled skills loaded yet. Remote content is never trusted automatically.</Text> : null}</Screen>; }
