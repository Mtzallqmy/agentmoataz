/**
 * ModelDrivenPlanner — asks the model for a structured plan and validates/
 * repairs it. Falls back to the deterministic planner when the model output
 * is unusable. Cycle detection + size limits keep plans safe.
 */
import { z } from "zod";
import type { ChatMessage } from "@agentmoataz/agent-protocol";
import type { ModelProvider } from "@agentmoataz/agent-models";
import { defaultPlan, type PlanInput, type PlannedStep } from "./planner.js";

const MAX_PLAN_STEPS = 15;

export const PlanStepSchema = z.object({
  title: z.string().min(1).max(200),
  goal: z.string().max(1000).optional(),
  dependencies: z.array(z.string()).default([]),
  expectedTools: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
});

export const PlanSchema = z.object({
  steps: z.array(PlanStepSchema).min(1).max(MAX_PLAN_STEPS),
});

/** Detect dependency cycles; returns the offending ids (empty = acyclic). */
export function findCycle(steps: Array<{ id: string; dependencies: string[] }>): string[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const state = new Map<string, 0 | 1 | 2>(); // white/grey/black
  let cycle: string[] = [];

  const visit = (id: string, stack: string[]): void => {
    if (cycle.length) return;
    const st = state.get(id) ?? 0;
    if (st === 1) {
      cycle = [...stack.slice(stack.indexOf(id)), id];
      return;
    }
    if (st === 2) return;
    state.set(id, 1);
    for (const dep of byId.get(id)?.dependencies ?? []) {
      if (byId.has(dep)) visit(dep, [...stack, id]);
      if (cycle.length) return;
    }
    state.set(id, 2);
  };
  for (const s of steps) visit(s.id, []);
  return cycle;
}

function extractJson(text: string): unknown {
  // strip markdown fences and take the outermost JSON object
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no json object found");
  return JSON.parse(cleaned.slice(start, end + 1));
}

export interface ParsedPlan {
  steps: Array<{
    title: string;
    goal?: string;
    dependencies: string[];
    expectedTools: string[];
    acceptanceCriteria: string[];
  }>;
}

/** Repair: schema-validate, dedupe titles, drop dangling deps, break cycles. */
export function repairPlan(raw: unknown): ParsedPlan {
  const data = PlanSchema.parse(raw); // throws on unusable shape -> caller falls back

  const out: ParsedPlan["steps"] = [];
  const titles = new Set<string>();
  for (const s of data.steps) {
    const key = s.title.trim().toLowerCase();
    if (titles.has(key)) continue; // dedupe
    titles.add(key);
    // dependencies reference PRIOR step indexes as strings ("0","1"); drop invalid refs
    const deps = s.dependencies.filter((d) => /^\d+$/.test(d) && Number(d) < out.length);
    out.push({
      title: s.title,
      ...(s.goal !== undefined ? { goal: s.goal } : {}),
      dependencies: deps,
      expectedTools: s.expectedTools,
      acceptanceCriteria: s.acceptanceCriteria,
    });
  }

  const cycle = findCycle(out.map((s, i) => ({ id: String(i), dependencies: s.dependencies })));
  if (cycle.length) throw new Error("cycle detected in plan");
  return { steps: out };
}

export interface PlannerContext {
  memory?: string[];
  skills?: string[];
  capabilities?: string[];
  workspaceSummary?: string;
}

export class ModelDrivenPlanner {
  constructor(private provider: ModelProvider) {}

  async plan(input: PlanInput, ctx?: PlannerContext): Promise<PlannedStep[]> {
    const contextLines = [
      ...(ctx?.memory?.length ? [`Relevant memory:\n- ${ctx.memory.join("\n- ")}`] : []),
      ...(ctx?.skills?.length ? [`Available skills: ${ctx.skills.join(", ")}`] : []),
      ...(ctx?.capabilities?.length ? [`Tool capabilities: ${ctx.capabilities.join(", ")}`] : []),
      ...(ctx?.workspaceSummary ? [`Workspace summary: ${ctx.workspaceSummary}`] : []),
    ];

    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          "You are a planning engine. Reply with ONLY a JSON object of shape " +
          '{"steps":[{"title":string,"goal"?:string,"dependencies"?:string[],"expectedTools"?:string[],"acceptanceCriteria"?:string[]}]}. ' +
          `Maximum ${MAX_PLAN_STEPS} steps. Dependencies reference prior step indexes as strings. No prose.`,
      },
      {
        role: "user",
        content: `Goal: ${input.goal}\n\n${contextLines.join("\n\n")}`,
      },
    ];

    try {
      const res = await this.provider.chat({ messages, temperature: 0 });
      const raw = extractJson(res.content);
      const plan = repairPlan(raw);
      if (plan.steps.length === 0) return defaultPlan(input);
      return plan.steps.map((s) => ({
        title: s.title,
        ...(s.goal !== undefined ? { goal: s.goal } : {}),
        expectedTools: s.expectedTools,
      }));
    } catch {
      return defaultPlan(input); // deterministic fallback
    }
  }
}
