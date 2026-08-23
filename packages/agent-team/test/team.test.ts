import { describe, it, expect } from "vitest";
import { AgentTeam, AgentRole } from "../src/index.js";

describe("AgentTeam", () => {
  it("delegates, completes and persists the audit trail", () => {
    const team = new AgentTeam();
    const d = team.delegate("MANAGER", "CODER", "implement login screen");
    expect(d.status).toBe("pending");
    team.complete(d.id, "wrote LoginScreen.tsx + tests");
    expect(team.auditTrail).toHaveLength(1);
    expect(team.auditTrail[0]!.status).toBe("completed");
  });

  it("enforces delegation budget (no uncontrolled self-spawn)", () => {
    const team = new AgentTeam({ limits: { maxDelegationsPerRun: 3 } });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(team.delegate("MANAGER", "CODER", `task ${i}`).id);
    }
    const statuses = ids.map((id) => team.auditTrail.find((d) => d.id === id)!.status);
    expect(statuses.filter((s) => s === "pending")).toHaveLength(3);
    expect(statuses.filter((s) => s === "failed")).toHaveLength(2);
  });

  it("enforces depth limit", () => {
    const team = new AgentTeam({ limits: { maxDepth: 1 } });
    const tooDeep = team.delegate("MANAGER", "PLANNER", "spawn sub-sub-agent", 2);
    expect(tooDeep.status).toBe("failed");
    expect(tooDeep.error?.message).toContain("depth");
  });

  it("strict reviewer rejects empty changes and unresolved TODOs", async () => {
    const team = new AgentTeam({ reviewer: AgentTeam.strictReviewer() });

    const bad = await team.review({
      changes: "// TODO fix later",
      acceptanceCriteria: [],
    });
    expect(bad.approved).toBe(false);
    expect(bad.issues.join("; ")).toMatch(/TODO/);

    const empty = await team.review({ changes: "", acceptanceCriteria: [] });
    expect(empty.approved).toBe(false);

    const criteriaFail = await team.review({
      changes: "solid implementation with tests",
      acceptanceCriteria: ["FAIL: build broken"],
    });
    expect(criteriaFail.approved).toBe(false);

    const good = await team.review({
      changes: "+ added feature\n+ added test",
      acceptanceCriteria: ["tests pass"],
    });
    expect(good.approved).toBe(true);
  });

  it("roles are constrained by type", () => {
    const roles: AgentRole[] = ["MANAGER", "PLANNER", "CODER", "RESEARCHER", "REVIEWER", "MEDIA"];
    const team = new AgentTeam();
    for (const r of roles) {
      expect(() => team.delegate("MANAGER", r, "x")).not.toThrow();
    }
  });
});
