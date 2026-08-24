/**
 * Planner + TaskGraph.
 *
 * A plan is a DAG of steps. The planner can add/split/reorder future steps
 * but never silently deletes completed history.
 */
import type { StepState, TaskStep } from "@agentmoataz/agent-protocol";

export class TaskGraph {
  private steps: TaskStep[] = [];
  private seq = 0;

  constructor(
    public readonly runId: string,
    public readonly taskId: string,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  get all(): readonly TaskStep[] { return this.steps; }

  pending(): TaskStep[] { return this.steps.filter((step) => step.status === "pending"); }

  nextRunnable(): TaskStep | null {
    for (const step of this.pending()) {
      const depsOk = step.dependencies.every((depId) => {
        const dep = this.steps.find((candidate) => candidate.id === depId);
        return !dep || dep.status === "completed" || dep.status === "skipped";
      });
      if (depsOk) return step;
    }
    return null;
  }

  addStep(init: {
    title: string;
    goal?: string;
    dependencies?: string[];
    expectedTools?: string[];
    acceptanceCriteria?: string[];
  }): TaskStep {
    const ts = this.now();
    const step: TaskStep = {
      id: `step-${this.runId}-${++this.seq}`,
      taskId: this.taskId,
      title: init.title,
      goal: init.goal ?? "",
      dependencies: init.dependencies ?? [],
      expectedTools: init.expectedTools ?? [],
      acceptanceCriteria: init.acceptanceCriteria ?? [],
      status: "pending",
      attempt: 0,
      createdAt: ts,
      updatedAt: ts,
    };
    this.steps.push(step);
    return step;
  }

  /** Split a pending step into two sequential sub-steps; original is cancelled without erasing history. */
  splitStep(stepId: string, parts: Array<{ title: string; goal?: string; expectedTools?: string[]; acceptanceCriteria?: string[] }>): TaskStep[] {
    const original = this.steps.find((s) => s.id === stepId);
    if (!original) throw new Error(`unknown step ${stepId}`);
    if (original.status !== "pending") throw new Error(`only pending steps can be split, got ${original.status}`);
    this.setStatus(stepId, "cancelled");
    const created: TaskStep[] = [];
    let prevId = stepId;
    for (const part of parts) {
      const s = this.addStep({ ...part, dependencies: [prevId, ...(part as unknown as { dependencies?: string[] }).dependencies ?? []] });
      // Keep dependency on original's dependencies for first part
      if (created.length === 0) s.dependencies = [...new Set([...original.dependencies, ...s.dependencies.filter((d) => d !== stepId)])];
      created.push(s);
      prevId = s.id;
    }
    return created;
  }

  /** Reorder only pending future steps (by id order); never touches completed/failed. */
  reorderPending(newOrderIds: string[]): void {
    const pending = this.pending();
    const pendingIds = new Set(pending.map((s) => s.id));
    if (newOrderIds.length !== pending.length || !newOrderIds.every((id) => pendingIds.has(id))) throw new Error("reorder must include exactly all pending ids");
    const map = new Map(this.steps.map((s) => [s.id, s] as const));
    const reorderedPending = newOrderIds.map((id) => map.get(id)!);
    const completed = this.steps.filter((s) => s.status !== "pending");
    this.steps = [...completed, ...reorderedPending];
  }

  /** Return up to `limit` runnable steps in parallel (dependency-free batch). */
  getRunnableBatch(limit = 3): TaskStep[] {
    const runnable: TaskStep[] = [];
    for (const step of this.pending()) {
      const depsOk = step.dependencies.every((depId) => {
        const dep = this.steps.find((c) => c.id === depId);
        return !dep || dep.status === "completed" || dep.status === "skipped";
      });
      if (depsOk) runnable.push(step);
      if (runnable.length >= limit) break;
    }
    return runnable;
  }

  /** Replanning: insert new future steps after a given step without erasing history. */
  replan(afterStepId: string, additions: Array<Parameters<TaskGraph["addStep"]>[0]>): TaskStep[] {
    const created = additions.map((addition) => this.addStep({ ...addition, dependencies: [afterStepId, ...(addition.dependencies ?? [])] }));
    const afterIdx = this.steps.findIndex((step) => step.id === afterStepId);
    for (let i = afterIdx + 1; i < this.steps.length; i++) {
      const step = this.steps[i]!;
      if (step.status === "pending" && !created.some((candidate) => candidate.id === step.id)) this.setStatus(step.id, "cancelled");
    }
    return created;
  }

  setStatus(stepId: string, status: StepState): void {
    const step = this.steps.find((candidate) => candidate.id === stepId);
    if (!step) throw new Error(`unknown step ${stepId}`);
    // Never delete completed history: disallow moving completed back to pending
    if (step.status === "completed" && status === "pending") throw new Error("completed history cannot be reset to pending");
    step.status = status;
    step.updatedAt = this.now();
    if (status === "running") step.attempt += 1;
  }

  completedCount(): number { return this.steps.filter((step) => step.status === "completed").length; }
}

export interface PlanInput {
  goal: string;
  contextHints?: string[];
}

export interface PlannedStep {
  title: string;
  goal?: string;
  /** Dependencies are prior plan-step indexes represented as strings. */
  dependencies?: string[];
  expectedTools?: string[];
  acceptanceCriteria?: string[];
}

/** Deterministic fallback planner used when no model-driven planner is configured. */
export function defaultPlan(input: PlanInput): PlannedStep[] {
  return [
    {
      title: "Understand goal and gather context",
      goal: input.goal,
      acceptanceCriteria: ["Relevant workspace context has been inspected before mutation"],
    },
    {
      title: "Execute primary work",
      expectedTools: ["write_file", "read_file"],
      acceptanceCriteria: ["Requested project changes are implemented through workspace tools"],
    },
    {
      title: "Verify results",
      expectedTools: ["read_file"],
      acceptanceCriteria: ["Important generated or modified files are read back and checked"],
    },
  ];
}
