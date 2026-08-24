/**
 * RuntimeStore contract — durable run/task/event persistence.
 *
 * AgentRuntime accepts an optional store: every important transition is
 * persisted, and on startup the app hydrates from it and marks mid-flight
 * runs as interrupted. The Android app backs this with expo-sqlite;
 * tests/tooling use the JSON file adapter from agent-persistence.
 */
import type { AgentEvent, AgentRun } from "@agentmoataz/agent-protocol";

export interface RuntimeStore {
  saveRun(run: AgentRun): Promise<void>;
  getRun(id: string): Promise<AgentRun | null>;
  listRuns(): Promise<AgentRun[]>;
  appendEvent(event: AgentEvent): Promise<void>;
  listEvents(runId: string): Promise<AgentEvent[]>;
}
