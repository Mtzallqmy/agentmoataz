import React, { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import type { AgentRun, Artifact } from "@agentmoataz/agent-protocol";
import { appAgentRuntime, type AppRuntimeSnapshot, type ProjectSummary, type ProviderSettings } from "./AppAgentRuntime";

const RuntimeContext = createContext(appAgentRuntime);

export function AppAgentProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => { void appAgentRuntime.initialize(); }, []);
  return <RuntimeContext.Provider value={appAgentRuntime}>{children}</RuntimeContext.Provider>;
}

export function useAgentRuntime() {
  const runtime = useContext(RuntimeContext);
  const snapshot = useSyncExternalStore(
    (listener) => runtime.subscribe(listener),
    () => runtime.getSnapshot(),
    () => runtime.getSnapshot()
  );
  return { runtime, snapshot };
}

export function useProjects() {
  const { runtime, snapshot } = useAgentRuntime();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = async () => {
    setLoading(true);
    try { setProjects(await runtime.listProjects()); } finally { setLoading(false); }
  };
  useEffect(() => { if (snapshot.initialized) void refresh(); }, [snapshot.initialized]);
  return { projects, loading, refresh, createProject: async (name: string) => { const project = await runtime.createProject(name); await refresh(); return project; } };
}

export function useRun(runId?: string | null) {
  const { runtime, snapshot } = useAgentRuntime();
  const target = runId ?? snapshot.activeRunId;
  return {
    runtime,
    activeRunId: snapshot.activeRunId,
    paused: snapshot.paused,
    events: target ? snapshot.events.filter((event) => event.runId === target || event.runId === "loop") : snapshot.events,
    error: snapshot.lastError,
  };
}

export function useApprovals() {
  const { runtime, snapshot } = useAgentRuntime();
  return { pendingApproval: snapshot.pendingApproval, approve: () => runtime.resolveApproval(true), deny: () => runtime.resolveApproval(false) };
}

export function useArtifacts(projectId: string | null) {
  const { runtime, snapshot } = useAgentRuntime();
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const refresh = async () => setArtifacts(projectId ? await runtime.listArtifacts(projectId) : []);
  useEffect(() => { if (snapshot.initialized) void refresh(); }, [snapshot.initialized, projectId]);
  return { artifacts, refresh, exportProject: async () => { if (!projectId) return null; const artifact = await runtime.exportProject(projectId); await refresh(); return artifact; } };
}

export function useRuns() {
  const { runtime, snapshot } = useAgentRuntime();
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const refresh = async () => setRuns((await runtime.listRuns()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  useEffect(() => { if (snapshot.initialized) void refresh(); }, [snapshot.initialized, snapshot.activeRunId]);
  return { runs, refresh };
}

export function useProviderSettings() {
  const { runtime, snapshot } = useAgentRuntime();
  const [settings, setSettings] = useState<ProviderSettings | null>(null);
  useEffect(() => { if (snapshot.initialized) void runtime.getProviderSettings().then(setSettings); }, [snapshot.initialized]);
  return {
    settings,
    configured: snapshot.providerConfigured,
    save: async (next: ProviderSettings, apiKey: string) => { await runtime.configureProvider(next, apiKey); setSettings(next); },
    remove: async () => { await runtime.removeProvider(); setSettings(null); },
    test: () => runtime.testProvider(),
  };
}

export type { AppRuntimeSnapshot, ProjectSummary, ProviderSettings };
