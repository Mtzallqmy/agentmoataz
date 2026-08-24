import React, { useState } from "react";
import { Text, View } from "react-native";
import { Button, Card, Screen, Title, ui } from "../components/AppUI";
import { useAgentRuntime } from "../services/AppAgentContext";
import type { ProfileName } from "@agentmoataz/agent-core";

const profiles: ProfileName[] = ["SAFE", "BALANCED", "AUTONOMOUS", "CUSTOM"];
export default function Settings() { const { runtime, snapshot } = useAgentRuntime(); const [profile, setProfile] = useState<ProfileName>("BALANCED"); return <Screen><Title hint="Dangerous actions remain approval-gated">Settings</Title><Card><Text style={ui.heading}>Permission profile</Text><View style={ui.row}>{profiles.map((item) => <Button key={item} tone={profile === item ? "primary" : "muted"} title={item} onPress={() => { setProfile(item); runtime.setPermissionProfile(item); }} />)}</View></Card><Card><Text style={ui.heading}>Local state</Text><Text style={ui.body}>SQLite: {snapshot.initialized ? "open" : "initializing"}</Text><Text style={ui.body}>Provider: {snapshot.providerConfigured ? "configured" : "missing"}</Text><Text style={ui.muted}>Heavy local runtimes and cloud sync remain disabled.</Text></Card></Screen>; }
