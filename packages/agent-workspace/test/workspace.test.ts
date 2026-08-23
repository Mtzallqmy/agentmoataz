import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import { Workspace } from "../src/index.js";
import { safeJoin } from "../src/paths.js";

let tmp: string;
let ws: Workspace;

beforeAll(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ws-test-"));
  ws = new Workspace(tmp);
});

afterAll(async () => {
  await fsp.rm(tmp, { recursive: true, force: true });
});

describe("path security", () => {
  it.each([
    "../escape.txt",
    "..\\escape.txt",
    "foo/../../escape",
    "/etc/passwd",
    "C:\\Windows\\system32\\config.sys",
    "a/../..",
  ])("blocks traversal attempt %j", (attempt) => {
    expect(() => safeJoin(tmp, attempt)).toThrow(/escapes project root|absolute/);
  });

  it("allows normal relative paths", () => {
    const p = safeJoin(tmp, "src/components/Button.tsx");
    expect(p.startsWith(path.resolve(tmp) + path.sep)).toBe(true);
  });

  it("allows the root itself", () => {
    expect(safeJoin(tmp, ".")).toBe(path.resolve(tmp));
  });
});

describe("file operations", () => {
  it("write -> read round-trip", async () => {
    await ws.writeFile("src/app.ts", "console.log(1);\n");
    expect(await ws.readFile("src/app.ts")).toBe("console.log(1);\n");
  });

  it("read of missing file yields structured error with technicalCause", async () => {
    try {
      await ws.readFile("nope/missing.txt");
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toMatch(/workspace operation failed/);
    }
  });

  it("listTree skips node_modules and .agent", async () => {
    await ws.writeFile("node_modules/pkg/index.js", "x");
    await ws.writeFile(".agent/logs/run.log", "y");
    await ws.writeFile("README.md", "# hi");
    const names = (await ws.listTree()).map((f) => f.relativePath);
    expect(names).toContain("README.md");
    expect(names.some((n) => n.includes("node_modules"))).toBe(false);
    expect(names.some((n) => n.includes(".agent"))).toBe(false);
  });

  it("searchText finds matches with line numbers", async () => {
    await ws.writeFile("a/b.txt", "alpha\nbeta\nalpha again\n");
    const hits = await ws.searchText("alpha", "a");
    expect(hits).toHaveLength(2);
    expect(hits[0]!.line).toBe(1);
  });

  it("replaceText replaces all occurrences and reports count", async () => {
    await ws.writeFile("c.txt", "one one one");
    const count = await ws.replaceText("c.txt", "one", "two");
    expect(count).toBe(3);
    expect(await ws.readFile("c.txt")).toBe("two two two");
  });

  it("diffFiles renders unified diff", async () => {
    await ws.writeFile("d1.txt", "a\nb\nc\n");
    await ws.writeFile("d2.txt", "a\nX\nc\n");
    const diff = await ws.diffFiles("d1.txt", "d2.txt");
    expect(diff).toContain("--- d1.txt");
    expect(diff).toContain("+ X");
  });

  it("moveFile works within the workspace", async () => {
    await ws.writeFile("m/from.txt", "data");
    await ws.moveFile("m/from.txt", "m2/to.txt");
    expect(await ws.readFile("m2/to.txt")).toBe("data");
  });

  it("deleteFile removes file", async () => {
    await ws.writeFile("del/me.txt", "bye");
    await ws.deleteFile("del/me.txt");
    await expect(ws.readFile("del/me.txt")).rejects.toThrow();
  });
});

describe("zip export", () => {
  it("creates a zip excluding secrets and returns sha256 checksum", async () => {
    await ws.writeFile("proj/index.ts", "export {};");
    await ws.writeFile("proj/.env", "SECRET=1");
    await ws.writeFile("proj/node_modules/lib.js", "cached");

    const checksum = await ws.createZip("exports/proj.zip", {
      exclude: [/(^|\/)node_modules\//, /(^|\/)\.env$/, /(^|\/)\.agent\//],
    });

    expect(checksum).toMatch(/^[0-9a-f]{64}$/);
    const zipPath = path.join(tmp, "exports", "proj.zip");
    expect(fs.existsSync(zipPath)).toBe(true);

    // verify contents via JSZip
    const JSZip = (await import("jszip")).default;
    const loaded = await JSZip.loadAsync(fs.readFileSync(zipPath));
    const names = Object.keys(loaded.files);
    expect(names).toContain("proj/index.ts");
    expect(names.some((n) => n.endsWith(".env"))).toBe(false);
    expect(names.some((n) => n.includes("node_modules"))).toBe(false);
  });
});
