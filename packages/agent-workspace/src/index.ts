import { utf8Encode, type CryptoAdapter, type FileSystemAdapter, type PathAdapter, type PlatformAdapters } from "@agentmoataz/agent-platform";
import { AgentError, type StructuredError } from "@agentmoataz/agent-protocol";
import { safeJoin, maxFileBytes } from "./paths.js";
import JSZip from "jszip";

export interface FileEntry {
  relativePath: string;
  sizeBytes: number;
  isDirectory: boolean;
}

type WorkspacePlatform = Pick<PlatformAdapters, "fs" | "path" | "crypto">;

/** Project-rooted workspace with no Node runtime dependency. */
export class Workspace {
  private fs: FileSystemAdapter;
  private paths: PathAdapter;
  private crypto: CryptoAdapter;

  constructor(readonly root: string, platform: WorkspacePlatform) {
    this.fs = platform.fs;
    this.paths = platform.path;
    this.crypto = platform.crypto;
  }

  private absolute(relativePath: string): string {
    return safeJoin(this.root, relativePath, this.paths);
  }

  async listTree(subdir = "", depth = 6): Promise<FileEntry[]> {
    const base = this.absolute(subdir);
    const out: FileEntry[] = [];
    const walk = async (dir: string, rel: string, level: number): Promise<void> => {
      if (level > depth) return;
      let entries;
      try { entries = await this.fs.list(dir); } catch { return; }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name === ".agent" || entry.name === "node_modules") continue;
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        out.push({ relativePath: childRel, sizeBytes: entry.isDirectory ? 0 : entry.sizeBytes, isDirectory: entry.isDirectory });
        if (entry.isDirectory) await walk(entry.path, childRel, level + 1);
      }
    };
    await walk(base, subdir.replace(/\\/g, "/").replace(/\/$/, ""), 0);
    return out;
  }

  async readFile(relativePath: string): Promise<string> {
    const absolute = this.absolute(relativePath);
    await this.assertSizeLimit(absolute);
    try { return await this.fs.readText(absolute); } catch (error) { throw wrapFsError(error, relativePath); }
  }

  async readRange(relativePath: string, offsetLines: number, count: number): Promise<string[]> {
    return (await this.readFile(relativePath)).split(/\r?\n/).slice(offsetLines, offsetLines + count);
  }

  async fileMetadata(relativePath: string): Promise<{ sizeBytes: number; modifiedAt: string }> {
    const stat = await this.fs.stat(this.absolute(relativePath));
    return { sizeBytes: stat.sizeBytes, modifiedAt: new Date(stat.modifiedAtMs).toISOString() };
  }

  async hashFile(relativePath: string): Promise<string> {
    return this.crypto.sha256Bytes(await this.fs.readBytes(this.absolute(relativePath)));
  }

  async writeFile(relativePath: string, content: string): Promise<void> {
    if (utf8Encode(content).byteLength > maxFileBytes()) {
      throw new AgentError({ code: "INVALID_TOOL_ARGUMENT", category: "workspace", message: `file exceeds ${maxFileBytes()} byte limit`, recoverable: false, retryable: false });
    }
    await this.fs.writeText(this.absolute(relativePath), content);
  }

  async writeBytes(relativePath: string, content: Uint8Array): Promise<void> {
    if (content.byteLength > maxFileBytes()) {
      throw new AgentError({ code: "INVALID_TOOL_ARGUMENT", category: "workspace", message: `file exceeds ${maxFileBytes()} byte limit`, recoverable: false, retryable: false });
    }
    await this.fs.writeBytes(this.absolute(relativePath), content);
  }

  async createDirectory(relativePath: string): Promise<void> { await this.fs.mkdir(this.absolute(relativePath)); }
  async deleteFile(relativePath: string): Promise<void> { try { await this.fs.remove(this.absolute(relativePath), true); } catch (error) { throw wrapFsError(error, relativePath); } }

  async copyFile(fromRel: string, toRel: string): Promise<void> {
    const from = this.absolute(fromRel);
    await this.assertSizeLimit(from);
    await this.fs.copy(from, this.absolute(toRel));
  }

  async moveFile(fromRel: string, toRel: string): Promise<void> { await this.fs.rename(this.absolute(fromRel), this.absolute(toRel)); }

  async searchText(pattern: string, subdir = ""): Promise<Array<{ relativePath: string; line: number; text: string }>> {
    const regex = new RegExp(escapeRegex(pattern), "gi");
    const results: Array<{ relativePath: string; line: number; text: string }> = [];
    for (const file of (await this.listTree(subdir)).filter((entry) => !entry.isDirectory && entry.sizeBytes <= maxFileBytes())) {
      const lines = (await this.readFile(file.relativePath)).split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        regex.lastIndex = 0;
        if (regex.test(lines[i]!)) results.push({ relativePath: file.relativePath, line: i + 1, text: lines[i]!.slice(0, 300) });
      }
    }
    return results.slice(0, 500);
  }

  async replaceText(relativePath: string, search: string, replacement: string, all = true): Promise<number> {
    const content = await this.readFile(relativePath);
    if (!content.includes(search)) return 0;
    const next = all ? content.split(search).join(replacement) : content.replace(search, replacement);
    await this.writeFile(relativePath, next);
    return all ? content.split(search).length - 1 : 1;
  }

  async diffFiles(aRel: string, bRel: string): Promise<string> {
    return simpleDiff(aRel, bRel, (await this.readFile(aRel)).split(/\r?\n/), (await this.readFile(bRel)).split(/\r?\n/));
  }

  async createZip(zipRelativePath: string, options?: { exclude?: RegExp[] }): Promise<string> {
    const zip = new JSZip();
    const exclude = options?.exclude ?? [/(^|\/)node_modules\//, /(^|\/)\.env$/, /(^|\/)\.agent\//, /(^|\/)\.git\//];
    const files = (await this.listTree("")).filter((entry) => !entry.isDirectory && !exclude.some((regex) => regex.test(entry.relativePath)));
    for (const file of files) zip.file(file.relativePath, await this.fs.readBytes(this.absolute(file.relativePath)));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    await this.writeBytes(zipRelativePath, bytes);
    return this.crypto.sha256Bytes(bytes);
  }

  private async assertSizeLimit(absolute: string): Promise<void> {
    if (!(await this.fs.exists(absolute))) return;
    const stat = await this.fs.stat(absolute);
    if (stat.sizeBytes > maxFileBytes()) {
      throw new AgentError({ code: "INVALID_TOOL_ARGUMENT", category: "workspace", message: `refusing to load file larger than ${maxFileBytes()} bytes`, recoverable: false, retryable: false });
    }
  }
}

function wrapFsError(error: unknown, path: string): Error {
  if (error instanceof AgentError) return error;
  return new AgentError({ code: "INVALID_TOOL_ARGUMENT", category: "workspace", message: `workspace operation failed for ${JSON.stringify(path)}`, recoverable: false, retryable: false, technicalCause: error instanceof Error ? error.message : String(error) }) as Error & StructuredError;
}

function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export function simpleDiff(aName: string, bName: string, a: string[], b: string[]): string {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: string[] = [`--- ${aName}`, `+++ ${bName}`];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push(`  ${a[i]}`); i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) out.push(`- ${a[i++]}`);
    else out.push(`+ ${b[j++]}`);
  }
  while (i < n) out.push(`- ${a[i++]}`);
  while (j < m) out.push(`+ ${b[j++]}`);
  return out.join("\n");
}
