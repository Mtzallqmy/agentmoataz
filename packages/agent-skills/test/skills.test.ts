import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SkillManager } from "../src/index.js";
import { nodePlatform } from "@agentmoataz/agent-platform/node";

describe("SkillManager", () => {
  it("loads valid skills from a directory tree", async () => {
    const mgr = new SkillManager(nodePlatform, { includeBuiltins: false });
    const n = await mgr.loadFrom(path.join(fileURLToPath(new URL("../", import.meta.url)), "testdata", "skills"));
    expect(n).toBe(1);
    const skill = mgr.get("create-expo-project")!;
    expect(skill.metadata.steps.length).toBeGreaterThanOrEqual(3);
    expect(skill.record.allowedTools).toContain("write_file");
    expect(skill.markdown).toContain("create-expo-project");
  });

  it("rejects invalid metadata (missing steps)", async () => {
    const mgr = new SkillManager(nodePlatform, { includeBuiltins: false });
    await expect(
      mgr.loadSkill(path.join(fileURLToPath(new URL("../", import.meta.url)), "testdata", "skills", "coding", "nonexistent"))
    ).rejects.toThrow();
  });

  it("enable/disable and trigger matching", async () => {
    const mgr = new SkillManager(nodePlatform, { includeBuiltins: false });
    await mgr.loadFrom(path.join(fileURLToPath(new URL("../", import.meta.url)), "testdata", "skills"));

    expect(mgr.match("please create expo project for me")).toHaveLength(1);
    expect(mgr.match("unrelated goal")).toHaveLength(0);

    mgr.setEnabled("create-expo-project", false);
    expect(mgr.match("create expo project")).toHaveLength(0);
    expect(mgr.enabled()).toHaveLength(0);

    mgr.setEnabled("create-expo-project", true);
    expect(mgr.enabled()).toHaveLength(1);
  });

  it("ships useful built-in skills for the mobile runtime", () => {
    const mgr = new SkillManager(nodePlatform);
    expect(mgr.get("create-expo-project")).toBeTruthy();
    expect(mgr.get("research-topic")).toBeTruthy();
    expect(mgr.get("package-project")).toBeTruthy();
    expect(mgr.match("create an Expo Android app").length).toBeGreaterThan(0);
  });
});
