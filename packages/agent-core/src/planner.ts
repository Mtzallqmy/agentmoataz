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

  get all(): readonly TaskStep[] {
    return this.steps;
  }

  pending(): TaskStep[] {
    return this.steps.filter((s) => s.status === "pending");
  }

  nextRunnable(): TaskStep | null {
    for (const step of this.pending()) {
      const depsOk = step.dependencies.every((depId) => {
        const dep = this.steps.find((s) => s.id === depId);
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

  /** Replanning: insert new future steps after a given step without erasing history. */
  replan(afterStepId: string, additions: Array<Parameters<TaskGraph["addStep"]>[0]>): TaskStep[] {
    const created = additions.map((a) => this.addStep({ ...a, dependencies: [afterStepId, ...(a.dependencies ?? [])] }));
    // cancel other still-pending steps that came after the failure point and are not deps of new plan
    const afterIdx = this.steps.findIndex((s) => s.id === afterStepId);
    for (let i = afterIdx + 1; i < this.steps.length; i++) {
      const s = this.steps[i]!;
      if (s.status === "pending" && !created.some((c) => c.id === s.id)) {
        this.setStatus(s.id, "cancelled");
      }
    }
    return created;
  }

  setStatus(stepId: string, status: StepState): void {
    const step = this.steps.find((s) => s.id === stepId);
    if (!step) throw new Error(`unknown step ${stepId}`);
    step.status = status;
    step.updatedAt = this.now();
    if (status === "running") step.attempt += 1;
  }

  completedCount(): number {
    return this.steps.filter((s) => s.status === "completed").length;
  }
}

export interface PlanInput {
  goal: string;
  contextHints?: string[];
}

export interface PlannedStep {
  title: string;
  goal?: string;
  expectedTools?: string[];
}

/** Deterministic default planner used when no model-driven planner is configured. */
export function defaultPlan(input: PlanInput): PlannedStep[] {
  return [
    { title: "Understand goal and gather context", goal: input.goal },
    { title: "Execute primary work", expectedTools: ["write_file", "read_file"] },
    { title: "Verify results", expectedTools: ["read_file"] },
  ];
}
