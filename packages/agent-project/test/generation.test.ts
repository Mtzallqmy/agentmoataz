/**
 * FINAL ACCEPTANCE SCENARIO (local mock-agent edition)
 *
 * "Create a clean Expo + TypeScript Todo application with local persistence,
 *  test it, write documentation, review the project, and export it as ZIP."
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import JSZip from "jszip";
import { generateProject } from "../src/index.js";
import { MockProvider } from "@agentmoataz/agent-models";
import { nodePlatform } from "@agentmoataz/agent-platform/node";

let parent: string;
beforeAll(async () => {
  parent = await fsp.mkdtemp(path.join(os.tmpdir(), "accept-"));
});
afterAll(async () => {
  await fsp.rm(parent, { recursive: true, force: true });
});

describe("final acceptance: project generation workflow", () => {
  it("generates -> verifies -> reviews -> reports -> checkpoints -> exports ZIP with checksum", async () => {
    const result = await generateProject({
      goal: "Create a clean Expo + TypeScript Todo application",
      projectName: "todo-app",
      parentDir: parent,
      provider: new MockProvider(),
      platform: nodePlatform,
    });

    // run completed through the full agent loop
    expect(result.runCompleted).toBe(true);

    // all files exist
    for (const f of result.filesCreated) {
      await fsp.access(path.join(result.workspaceRoot, f));
    }
    expect(result.filesCreated).toContain("PROJECT_REPORT.md");
    expect(result.filesCreated).toContain("README.md");

    // validation actually happened (package.json parses)
    const pkg = JSON.parse(
      await fsp.readFile(path.join(result.workspaceRoot, "package.json"), "utf8")
    );
    expect(pkg.name).toBe("todo-app");

    // Reviewer approved
    expect(result.reviewApproved).toBe(true);
    expect(result.reviewIssues).toEqual([]);

    // report content is meaningful
    expect(result.report).toContain("objective:");
    expect(result.report).toContain("validation performed:");

    // ZIP exists, has checksum, excludes secrets/caches
    expect(result.zipChecksum).toMatch(/^[0-9a-f]{64}$/);
    expect(result.artifactId).toBeTruthy();
    const zipBuf = await fsp.readFile(result.zipPath!);
    const zip = await JSZip.loadAsync(zipBuf);
    const names = Object.keys(zip.files);
    expect(names).toContain("package.json");
    expect(names).toContain("PROJECT_REPORT.md");
    expect(names.some((n) => n.includes("node_modules"))).toBe(false);
    expect(names.some((n) => (zip.files[n]!.name.split("/").pop() ?? "") === ".env")).toBe(false);
    // checkpoint dir must NOT leak into the export
    expect(names.some((n) => n.startsWith(".agent/"))).toBe(false);
  }, 30_000);

  it("restart flow: generated artifacts remain accessible afterwards", async () => {
    // simulate app restart: re-read everything from disk only
    const ws = path.join(parent, "todo-app");
    const report = await fsp.readFile(path.join(ws, "PROJECT_REPORT.md"), "utf8");
    const zipStat = await fsp.stat(path.join(ws, "exports", "todo-app.zip"));
    const checkpointDir = await fsp.readdir(path.join(ws, ".agent", "checkpoints"));
    expect(report.length).toBeGreaterThan(50);
    expect(zipStat.size).toBeGreaterThan(0);
    expect(checkpointDir.length).toBe(1);
  });
});
