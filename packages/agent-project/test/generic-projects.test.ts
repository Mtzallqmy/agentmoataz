import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import { detectProjectKind, generateProject } from "../src/index.js";
import { nodePlatform } from "@agentmoataz/agent-platform/node";
import { MockProvider } from "@agentmoataz/agent-models";

let root: string;
beforeAll(async () => { root = await fsp.mkdtemp(path.join(os.tmpdir(), "generic-projects-")); });
afterAll(async () => { await fsp.rm(root, { recursive: true, force: true }); });

describe("generic project generation", () => {
  it.each([
    ["Create a simple HTML calculator", "calc", "html-calculator", ["index.html", "styles.css", "script.js"]],
    ["Build a small TypeScript CLI", "tiny-cli", "typescript-cli", ["package.json", "src/index.ts", "tsconfig.json"]],
    ["Create an Expo counter screen", "counter", "expo-counter", ["package.json", "App.tsx", "tsconfig.json"]],
  ] as const)("supports %s", async (goal, name, expectedKind, required) => {
    const result = await generateProject({ goal, projectName: name, parentDir: root, provider: new MockProvider(), platform: nodePlatform });
    expect(result.kind).toBe(expectedKind);
    expect(result.validation.passed).toBe(true);
    expect(result.reviewApproved).toBe(true);
    expect(result.zipChecksum).toMatch(/^[0-9a-f]{64}$/);
    for (const file of required) await expect(fsp.access(path.join(result.workspaceRoot, file))).resolves.toBeUndefined();
  }, 30_000);

  it("does not force arbitrary requests into the Todo fixture", () => {
    expect(detectProjectKind("Create a weather dashboard")).toBe("custom");
    expect(detectProjectKind("Create an HTML calculator")).not.toBe("expo-todo");
  });
});
