import { describe, it, expect } from "vitest";
import { MemoryManager, InMemoryMemoryStore } from "../src/index.js";

describe("MemoryManager", () => {
  it("stores and retrieves relevant memory by relevance, not dump-all", async () => {
    const mgr = new MemoryManager(new InMemoryMemoryStore());
    await mgr.remember({ scope: "project", scopeKey: "p1", content: "uses pnpm and TypeScript strict" });
    await mgr.remember({ scope: "long_term", content: "user prefers dark mode UI" });
    await mgr.remember({ scope: "session", content: "weather smalltalk" });

    const hits = await mgr.retrieve("package manager typescript", { limit: 2 });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.content).toContain("pnpm");
  });

  it("respects enabled flag and deletion", async () => {
    const mgr = new MemoryManager(new InMemoryMemoryStore());
    const rec = await mgr.remember({ scope: "working", content: "temporary note about build" });

    await mgr.setEnabled(rec.id, false);
    expect(await mgr.retrieve("build")).toHaveLength(0);

    await mgr.setEnabled(rec.id, true);
    expect(await mgr.retrieve("build")).toHaveLength(1);

    await mgr.forget(rec.id);
    expect(await mgr.listAll()).toHaveLength(0);
  });

  it("updates content", async () => {
    const mgr = new MemoryManager();
    const rec = await mgr.remember({ scope: "project", content: "old fact" });
    const updated = await mgr.updateContent(rec.id, "new fact");
    expect(updated?.content).toBe("new fact");
  });
});
