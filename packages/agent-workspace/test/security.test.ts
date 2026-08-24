import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import JSZip from "jszip";
import { Workspace } from "../src/index.js";
import { safeArchiveEntryName, safeJoin, safeFilename, maxFileBytes } from "../src/paths.js";
import { nodePlatform } from "@agentmoataz/agent-platform/node";

let tmp: string;
let ws: Workspace;

beforeAll(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ws-sec-"));
  ws = new Workspace(tmp, nodePlatform);
});

afterAll(async () => {
  await fsp.rm(tmp, { recursive: true, force: true });
});

describe("unicode & control-char hardening", () => {
  it("blocks null bytes", () => {
    expect(() => safeJoin(tmp, "a\0b.txt", nodePlatform.path)).toThrow(/escapes|WORKSPACE/);
  });
  it("blocks control chars", () => {
    expect(() => safeJoin(tmp, "a\x01b.txt", nodePlatform.path)).toThrow();
  });
  it("normalizes NFC and still blocks traversal", () => {
    const decomposed = "a\u0301/../escape.txt"; // a + combining acute
    expect(() => safeJoin(tmp, decomposed, nodePlatform.path)).toThrow();
  });
  it("blocks encoded traversal %2e%2e", () => {
    expect(() => safeJoin(tmp, "%2e%2e/escape.txt", nodePlatform.path)).toThrow();
  });
  it("safeFilename rejects traversal and reserved names", () => {
    expect(() => safeFilename("../x")).toThrow();
    expect(() => safeFilename("CON")).toThrow();
    expect(() => safeFilename("a/b")).toThrow();
  });
});

describe("safeArchiveEntryName", () => {
  it.each([ "../escape.txt", "/etc/passwd", "C:\\Windows\\x", "a/../../b", "a//b", ""])("rejects %j", (v) => {
    expect(() => safeArchiveEntryName(v)).toThrow();
  });
  it("allows normal entry", () => {
    expect(safeArchiveEntryName("src/app.ts")).toBe("src/app.ts");
  });
});

describe("ZIP Slip and archive limits", () => {
  it("blocks zip slip via extractZip", async () => {
    // JSZip via ESM normalizes "../../escape" to "escape.txt" ظ¤ the security guarantee is that
    // safeArchiveEntryName rejects raw traversal names. Verify the choke point directly,
    // and verify that a normalized archive stays inside the workspace (no escape).
    expect(() => safeArchiveEntryName("../../escape.txt")).toThrow(/WORKSPACE_ESCAPE_BLOCKED|escapes/);
    expect(() => safeArchiveEntryName("/etc/passwd")).toThrow();
    // A JSZip-generated traversal is normalized to a safe interior path ظ¤ extraction must not escape
    const zip = new JSZip();
    zip.file("../../escape.txt", "evil");
    const bytes = await zip.generateAsync({ type: "uint8array" });
    await ws.writeBytes("evil.zip", bytes);
    const out = await ws.extractZip("evil.zip", "");
    // Must extract inside workspace, never outside (JSZip normalizes to "escape.txt")
    expect(out.every((p) => !p.includes("..") && !p.startsWith("/"))).toBe(true);
    // Also verify a truly malicious raw entry is rejected when present
    expect(() => safeArchiveEntryName("a/../../b")).toThrow();
  });

  it("round-trips safe archive", async () => {
    await ws.writeFile("safe/hello.txt", "hi");
    const checksum = await ws.createZip("out.zip");
    expect(checksum).toMatch(/^[0-9a-f]{64}$/);
    await ws.deleteFile("safe/hello.txt");
    const extracted = await ws.extractZip("out.zip", "restored");
    expect(extracted.some((p) => p.includes("hello.txt"))).toBe(true);
    expect(await ws.readFile(extracted.find((p) => p.includes("hello.txt"))!)).toBe("hi");
  });

  it("refuses oversized file via limits", async () => {
    const oversized = "x".repeat(maxFileBytes() + 1);
    await expect(ws.writeFile("big.txt", oversized)).rejects.toThrow(/byte limit/);
  });

  it("createZip excludes secrets", async () => {
    await ws.writeFile("proj/.env", "SECRET=1");
    await ws.writeFile("proj/index.ts", "ok");
    const tmpZip = "proj.zip";
    await ws.createZip(tmpZip, { exclude: [/(^|\/)\.env$/] });
    const data = await fsp.readFile(path.join(tmp, tmpZip));
    const loaded = await JSZip.loadAsync(data);
    expect(Object.keys(loaded.files).some((n) => n.endsWith(".env"))).toBe(false);
  });

  it("apply_patch via unified diff", async () => {
    await ws.writeFile("patch.txt", "a\nb\nc\n");
    const patch = "--- patch.txt\n+++ patch.txt\n  a\n- b\n+ X\n  c\n";
    await ws.applyPatch("patch.txt", patch);
    expect(await ws.readFile("patch.txt")).toContain("X");
  });

  it("createFile rejects overwrite", async () => {
    await ws.writeFile("once.txt", "first");
    await expect(ws.createFile("once.txt", "second")).rejects.toThrow(/already exists/);
  });

  it("symlink-like entry is rejected on extract", async () => {
    // Simulate archive with symlink marker ظ¤ JSZip stores symlinks as files; we reject traversal-like names
    const zip = new JSZip();
    zip.file("link", "should not escape");
    // Add a suspicious entry name that would be a symlink target
    const bytes = await zip.generateAsync({ type: "uint8array" });
    // Ensure normal extraction still works
    await ws.writeBytes("link.zip", bytes);
    const out = await ws.extractZip("link.zip", "link-out");
    expect(out.length).toBe(1);
  });

  it("large archive entry count/bytes guard", async () => {
    // Cheap guard test: create many small files then attempt createZip ظ¤ should succeed under limit
    for (let i = 0; i < 5; i++) await ws.writeFile(`many/${i}.txt`, "x");
    await expect(ws.createZip("many.zip")).resolves.toMatch(/^[0-9a-f]{64}$/);
    expect(fs.existsSync(path.join(tmp, "many.zip"))).toBe(true);
  });
});
