import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { nodePlatform } from "@agentmoataz/agent-platform/node";
import { Workspace } from "@agentmoataz/agent-workspace";
import { buildCoreFileTools } from "../src/core-tools.js";

let root = "";

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), "agent-core-tools-"));
});

afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

async function call(name: string, input: unknown) {
  const workspace = new Workspace(root, nodePlatform);
  const tool = buildCoreFileTools(workspace).find((entry) => entry.name === name);
  if (!tool) throw new Error(`missing tool ${name}`);
  const parsed = tool.inputSchema.parse(input);
  return tool.execute(parsed, { runId: "test", workspaceRoot: root });
}

describe("portable core workspace tools", () => {
  it("supports create/write/read/replace/hash/copy/move/list/diff", async () => {
    await call("create_directory", { path: "src" });
    await call("write_file", { path: "src/a.txt", content: "hello\nworld\n" });
    expect(await call("read_range", { path: "src/a.txt", offsetLines: 0, count: 1 })).toEqual({ lines: ["hello"] });
    expect(await call("replace_text", { path: "src/a.txt", search: "world", replacement: "agent" })).toEqual({ replacements: 1 });

    const hash = await call("hash_file", { path: "src/a.txt" }) as { sha256: string };
    expect(hash.sha256).toMatch(/^[0-9a-f]{64}$/);

    await call("copy_file", { from: "src/a.txt", to: "src/b.txt" });
    await call("move_file", { from: "src/b.txt", to: "src/c.txt" });
    const diff = await call("diff_files", { a: "src/a.txt", b: "src/c.txt" }) as { diff: string };
    expect(diff.diff).toContain("--- src/a.txt");

    const tree = await call("list_tree", { subdir: "src", depth: 2 }) as { entries: Array<{ relativePath: string }> };
    expect(tree.entries.map((entry) => entry.relativePath)).toEqual(expect.arrayContaining(["src/a.txt", "src/c.txt"]));
  });

  it("creates a ZIP and returns a checksum", async () => {
    await call("write_file", { path: "README.md", content: "ok" });
    const result = await call("create_zip", { path: "exports/project.zip" }) as { path: string; sha256: string };
    expect(result.path).toBe("exports/project.zip");
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    const stat = await fsp.stat(path.join(root, "exports", "project.zip"));
    expect(stat.size).toBeGreaterThan(0);
  });
});
