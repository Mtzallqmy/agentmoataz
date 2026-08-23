/**
 * CheckpointManager — snapshots workspace files (with SHA-256 manifest)
 * into <root>/.agent/checkpoints/<id>/ and can restore them.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { Checkpoint } from "@agentmoataz/agent-protocol";

const SKIP_DIRS = new Set([".git", "node_modules"]);

export class CheckpointManager {
  constructor(private workspaceRoot: string) {}

  private get baseDir(): string {
    return path.join(this.workspaceRoot, ".agent", "checkpoints");
  }

  async create(reason: string, runId?: string): Promise<Checkpoint> {
    const id = `cp-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const dir = path.join(this.baseDir, id);
    const filesRoot = path.join(dir, "files");
    const manifest: Checkpoint["manifest"] = [];

    await this.copyTree(this.workspaceRoot, filesRoot, filesRoot, manifest);
    await fsp.mkdir(dir, { recursive: true });
    const checkpoint: Checkpoint = {
      id,
      projectId: path.basename(this.workspaceRoot),
      runId: runId ?? null,
      reason,
      manifest,
      createdAt: new Date().toISOString(),
    };
    await fsp.writeFile(path.join(dir, "checkpoint.json"), JSON.stringify(checkpoint, null, 2), "utf8");
    return checkpoint;
  }

  async list(): Promise<Checkpoint[]> {
    try {
      const entries = await fsp.readdir(this.baseDir);
      const out: Checkpoint[] = [];
      for (const e of entries) {
        const raw = await fsp
          .readFile(path.join(this.baseDir, e, "checkpoint.json"), "utf8")
          .catch(() => null);
        if (raw) out.push(JSON.parse(raw) as Checkpoint);
      }
      return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    } catch {
      return [];
    }
  }

  async restore(id: string): Promise<number> {
    const dir = path.join(this.baseDir, id, "files");
    await fsp.access(dir); // throws if unknown checkpoint
    let restored = 0;
    // Remove current tracked files then copy snapshot back.
    for (const entry of await this.currentFiles()) {
      await fsp.rm(path.join(this.workspaceRoot, entry), { force: true }).catch(() => undefined);
    }
    restored += await this.copyBack(dir, this.workspaceRoot);
    return restored;
  }

  async delete(id: string): Promise<void> {
    await fsp.rm(path.join(this.baseDir, id), { recursive: true, force: true });
  }

  /* ---------------- internals ---------------- */

  private async copyTree(
    src: string,
    dest: string,
    filesRoot: string,
    manifest: Checkpoint["manifest"]
  ): Promise<void> {
    await fsp.mkdir(dest, { recursive: true });
    let entries;
    try {
      entries = await fsp.readdir(src, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.name === ".agent" && src === this.workspaceRoot) continue; // don't recurse into checkpoints
      const s = path.join(src, entry.name);
      const d = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await this.copyTree(s, d, filesRoot, manifest);
      } else {
        await fsp.mkdir(path.dirname(d), { recursive: true });
        await fsp.copyFile(s, d);
        const buf = await fsp.readFile(s);
        const rel = path.relative(filesRoot, d).split(path.sep).join("/");
        manifest.push({
          relativePath: rel,
          sha256: crypto.createHash("sha256").update(buf).digest("hex"),
          sizeBytes: buf.length,
        });
      }
    }
  }

  private async copyBack(src: string, dest: string): Promise<number> {
    let count = 0;
    const entries = await fsp.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const s = path.join(src, entry.name);
      const d = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        count += await this.copyBack(s, d);
      } else {
        await fsp.mkdir(path.dirname(d), { recursive: true });
        await fsp.copyFile(s, d);
        count++;
      }
    }
    return count;
  }

  private async currentFiles(): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string, rel: string): Promise<void> => {
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.isDirectory()) {
          if (SKIP_DIRS.has(e.name)) continue;
          if (e.name === ".agent" && dir === this.workspaceRoot) continue;
          await walk(path.join(dir, e.name), rel ? `${rel}/${e.name}` : e.name);
        } else {
          out.push(rel ? `${rel}/${e.name}` : e.name);
        }
      }
    };
    await walk(this.workspaceRoot, "");
    return out;
  }
}
