import { describe, it, expect } from "vitest";
import {
  ModelDrivenPlanner,
  repairPlan,
  findCycle,
} from "../src/model-planner.js";
import { defaultPlan } from "../src/planner.js";
import { MockProvider } from "@agentmoataz/agent-models";

const CALCULATOR_PLAN = `Here is the plan:
\`\`\`json
{"steps":[
  {"title":"Create index.html","expectedTools":["write_file"],"acceptanceCriteria":["file exists"]},
  {"title":"Create styles.css","dependencies":["0"]},
  {"title":"Create script.js with keyboard input","dependencies":["1"],"expectedTools":["write_file"]},
  {"title":"Verify in browser","dependencies":["2"]}
]}
\`\`\``;

const RESEARCH_PLAN = `{"steps":[
  {"title":"Formulate research question","goal":"foreground services"},
  {"title":"Search official Android docs","expectedTools":["http_get"]},
  {"title":"Extract evidence from sources","dependencies":["1"]},
  {"title":"Summarize findings","dependencies":["2"]}
]}`;

describe("ModelDrivenPlanner", () => {
  it("produces materially different plans for different goals and preserves validation metadata", async () => {
    const provider = new MockProvider({
      replies: [
        { match: "calculator", reply: CALCULATOR_PLAN },
        { match: "Research", reply: RESEARCH_PLAN },
      ],
    });
    const planner = new ModelDrivenPlanner(provider);

    const a = await planner.plan({ goal: "Create a calculator website" });
    const b = await planner.plan({ goal: "Research Android foreground services" });

    expect(a.map((s) => s.title)).toContain("Create index.html");
    expect(a.map((s) => s.title)).not.toContain("Search official Android docs");
    expect(b.map((s) => s.title)).toContain("Search official Android docs");
    expect(b.map((s) => s.title)).not.toContain("Create styles.css");
    expect(a[0]!.acceptanceCriteria).toEqual(["file exists"]);
    expect(a[1]!.dependencies).toEqual(["0"]);
  });

  it("repairs malformed plans (fences, dupes, dangling deps)", () => {
    const repaired = repairPlan({
      steps: [
        { title: "A", dependencies: ["9"], expectedTools: ["write_file"] },
        { title: "a", dependencies: [] },
        { title: "B", dependencies: ["0"] },
        { title: "C", dependencies: ["0", "1", "77"] },
      ],
    });
    expect(repaired.steps).toHaveLength(3);
    expect(repaired.steps[0]!.dependencies).toEqual([]);
    expect(repaired.steps[2]!.dependencies).toEqual(["0", "1"]);
  });

  it("detects cycles", () => {
    const cyc = findCycle([
      { id: "a", dependencies: ["b"] },
      { id: "b", dependencies: ["c"] },
      { id: "c", dependencies: ["a"] },
    ]);
    expect(cyc.length).toBeGreaterThan(0);
    const ok = findCycle([
      { id: "a", dependencies: [] },
      { id: "b", dependencies: ["a"] },
    ]);
    expect(ok).toEqual([]);
  });

  it("falls back to deterministic plan on garbage model output", async () => {
    const provider = new MockProvider({
      replies: [{ match: "goal", reply: "I cannot produce JSON right now, sorry!" }],
    });
    const planner = new ModelDrivenPlanner(provider);
    const plan = await planner.plan({ goal: "anything" });
    expect(plan.map((p) => p.title)).toEqual(defaultPlan({ goal: "anything" }).map((p) => p.title));
  });

  it("includes memory/skills context in the request", async () => {
    let captured = "";
    const provider = new MockProvider({ replies: [{ match: "", reply: RESEARCH_PLAN, toolCalls: undefined }] });
    const orig = provider.chat.bind(provider);
    provider.chat = async (req) => {
      captured = req.messages.map((m) => m.content).join("|");
      return orig(req);
    };
    const planner = new ModelDrivenPlanner(provider);
    await planner.plan(
      { goal: "Research topic" },
      { memory: ["user prefers pnpm"], skills: ["research-topic"], capabilities: ["read_file"] }
    );
    expect(captured).toContain("user prefers pnpm");
    expect(captured).toContain("research-topic");
    expect(captured).toContain("read_file");
  });
});
