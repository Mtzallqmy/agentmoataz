/**
 * Workspace file tools — the only way the agent touches project files.
 * Every operation is rooted at <projectRoot>/workspace.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { safeJoin, maxFileBytes } from "./paths.js";
import { AgentError, type StructuredError } from "@agentmoataz/agent-protocol";

export interface FileEntry {
  relativePath: string;
  sizeBytes: number;
  isDirectory: boolean;
}

export class Workspace {
  constructor(readonly root: string) {}

  /* ---------------- listing ---------------- */

  async listTree(subdir = "", depth = 6): Promise<FileEntry[]> {
    const base = safeJoin(this.root, subdir);
    const out: FileEntry[] = [];
    const walk = async (dir: string, rel: string, level: number): Promise<void> => {
      if (level > depth) return;
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name === ".agent" || entry.name === "node_modules") continue;
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          out.push({ relativePath: childRel, sizeBytes: 0, isDirectory: true });
          await walk(path.join(dir, entry.name), childRel, level + 1);
        } else {
          const st = await fsp.stat(path.join(dir, entry.name));
          out.push({ relativePath: childRel, sizeBytes: st.size, isDirectory: false });
        }
      }
    };
    await walk(base, subdir.replace(/\\/g, "/").replace(/\/$/, ""), 0);
    return out;
  }

  /* ---------------- reading ---------------- */

  async readFile(relativePath: string): Promise<string> {
    const abs = safeJoin(this.root, relativePath);
    await assertSizeLimit(abs);
    try {
      return await fsp.readFile(abs, "utf8");
    } catch (e) {
      throw wrapFsError(e, relativePath);
    }
  }

  async readRange(relativePath: string, offsetLines: number, count: number): Promise<string[]> {
    const content = await this.readFile(relativePath);
    const lines = content.split(/\r?\n/);
    return lines.slice(offsetLines, offsetLines + count);
  }

  async fileMetadata(relativePath: string): Promise<{ sizeBytes: number; modifiedAt: string }> {
    const abs = safeJoin(this.root, relativePath);
    const st = await fsp.stat(abs);
    return { sizeBytes: st.size, modifiedAt: st.mtime.toISOString() };
  }

  async hashFile(relativePath: string): Promise<string> {
    const abs = safeJoin(this.root, relativePath);
    return hashAbs(abs);
  }

  /* ---------------- writing ---------------- */

  async writeFile(relativePath: string, content: string): Promise<void> {
    if (Buffer.byteLength(content, "utf8") > maxFileBytes()) {
      throw new AgentError({
        code: "INVALID_TOOL_ARGUMENT",
        category: "workspace",
        message: `file exceeds ${maxFileBytes()} byte limit`,
        recoverable: false,
        retryable: false,
      });
    }
    const abs = safeJoin(this.root, relativePath);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, content, "utf8");
  }

  async createDirectory(relativePath: string): Promise<void> {
    const abs = safeJoin(this.root, relativePath);
    await fsp.mkdir(abs, { recursive: true });
  }

  async deleteFile(relativePath: string): Promise<void> {
    const abs = safeJoin(this.root, relativePath);
    await fsp.rm(abs, { recursive: true, force: false }).catch((e) => {
      throw wrapFsError(e, relativePath);
    });
  }

  async copyFile(fromRel: string, toRel: string): Promise<void> {
    const from = safeJoin(this.root, fromRel);
    const to = safeJoin(this.root, toRel);
    await assertSizeLimit(from);
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.copyFile(from, to);
  }

  async moveFile(fromRel: string, toRel: string): Promise<void> {
    const from = safeJoin(this.root, fromRel);
    const to = safeJoin(this.root, toRel);
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.rename(from, to);
  }

  /* ---------------- search / edit ---------------- */

  async searchText(pattern: string, subdir = ""): Promise<Array<{ relativePath: string; line: number; text: string }>> {
    const regex = new RegExp(escapeRegex(pattern), "gi");
    const results: Array<{ relativePath: string; line: number; text: string }> = [];
    const files = (await this.listTree(subdir)).filter((f) => !f.isDirectory && f.sizeBytes <= maxFileBytes());
    for (const f of files) {
      const content = await this.readFile(f.relativePath);
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        regex.lastIndex = 0;
        if (regex.test(lines[i]!)) {
          results.push({ relativePath: f.relativePath, line: i + 1, text: lines[i]!.slice(0, 300) });
        }
      }
    }
    return results.slice(0, 500);
  }

  async replaceText(
    relativePath: string,
    search: string,
    replacement: string,
    all = true
  ): Promise<number> {
    const content = await this.readFile(relativePath);
    if (!content.includes(search)) {
      return 0;
    }
    const next = all
      ? content.split(search).join(replacement)
      : content.replace(search, replacement);
    await this.writeFile(relativePath, next);
    return all ? content.split(search).length - 1 : 1;
  }

  /** Minimal unified diff of two files inside the workspace. */
  async diffFiles(aRel: string, bRel: string): Promise<string> {
    const a = (await this.readFile(aRel)).split(/\r?\n/);
    const b = (await this.readFile(bRel)).split(/\r?\n/);
    return simpleDiff(aRel, bRel, a, b);
  }

  /* ---------------- zip ---------------- */

  async createZip(zipRelativePath: string, options?: { exclude?: RegExp[] }): Promise<string> {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    const exclude = options?.exclude ?? [
      /(^|\/)node_modules\//,
      /(^|\/)\.env$/,
      /(^|\/)\.agent\//,
      /(^|\/)\.git\//,
    ];
    const files = (await this.listTree("")).filter(
      (f) => !f.isDirectory && !exclude.some((rx) => rx.test(f.relativePath))
    );
    for (const f of files) {
      zip.file(f.relativePath, await this.readFile(f.relativePath));
    }
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    await this.writeFile(zipRelativePath, buffer.toString("binary"));
    // write as binary-safe
    const abs = safeJoin(this.root, zipRelativePath);
    await fsp.writeFile(abs, buffer);
    const checksum = await hashAbs(abs);
    return checksum;
  }
}

/* ------------------------------------------------------------------ */

async function assertSizeLimit(abs: string): Promise<void> {
  const st = await fsp.stat(abs).catch(() => null);
  if (st && st.size > maxFileBytes()) {
    throw new AgentError({
      code: "INVALID_TOOL_ARGUMENT",
      category: "workspace",
      message: `refusing to load file larger than ${maxFileBytes()} bytes`,
      recoverable: false,
      retryable: false,
    });
  }
}

function wrapFsError(e: unknown, p: string): Error {
  if (e instanceof AgentError) return e;
  const cause = e instanceof Error ? e.message : String(e);
  return new AgentError({
    code: "INVALID_TOOL_ARGUMENT",
    category: "workspace",
    message: `workspace operation failed for ${JSON.stringify(p)}`,
    recoverable: false,
    retryable: false,
    technicalCause: cause,
  }) as Error & StructuredError;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hashAbs(abs: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
}

/** Simple LCS-based line diff rendered in unified style. */
export function simpleDiff(aName: string, bName: string, a: string[], b: string[]): string {
  const n = a.length;
  const m = b.length;
  // LCS table (fine for MVP-scale files)
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: string[] = [`--- ${aName}`, `+++ ${bName}`];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push(`  ${a[i]}`);
      i++; j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push(`- ${a[i++]}`);
    } else {
      out.push(`+ ${b[j++]}`);
    }
  }
  while (i < n) out.push(`- ${a[i++]}`);
  while (j < m) out.push(`+ ${b[j++]}`);
  return out.join("\n");
}
