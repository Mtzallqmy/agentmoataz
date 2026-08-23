/** Structured event bus. UI consumes these events; it never infers state from chat prose. */
import type { AgentEvent, AgentEventType, Id } from "@agentmoataz/agent-protocol";

type Handler = (event: AgentEvent) => void;

export class EventBus {
  private handlers = new Map<AgentEventType | "*", Set<Handler>>();
  private history: AgentEvent[] = [];
  private seq = 0;

  subscribe(type: AgentEventType | "*", handler: Handler): () => void {
    const set = this.handlers.get(type) ?? new Set();
    set.add(handler);
    this.handlers.set(type, set);
    return () => set.delete(handler);
  }

  emit(init: {
    id?: Id;
    type: AgentEventType;
    runId: Id;
    taskId?: Id | null;
    stepId?: Id | null;
    payload?: Record<string, unknown>;
  }): AgentEvent {
    const event: AgentEvent = {
      id: init.id ?? `evt-${++this.seq}-${Date.now()}`,
      type: init.type,
      runId: init.runId,
      taskId: init.taskId ?? null,
      stepId: init.stepId ?? null,
      payload: init.payload ?? {},
      createdAt: new Date().toISOString(),
    };
    this.history.push(event);
    for (const h of this.handlers.get(event.type) ?? []) h(event);
    for (const h of this.handlers.get("*") ?? []) h(event);
    return event;
  }

  eventsForRun(runId: string): AgentEvent[] {
    return this.history.filter((e) => e.runId === runId);
  }

  all(): readonly AgentEvent[] {
    return this.history;
  }
}
