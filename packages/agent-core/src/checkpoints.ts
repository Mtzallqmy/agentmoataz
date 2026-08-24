import type { Checkpoint } from "@agentmoataz/agent-protocol";
import type { PlatformAdapters } from "@agentmoataz/agent-platform";

const SKIP_DIRS = new Set([".git", "node_modules"]);

/** Platform-neutral workspace checkpoints with SHA-256 manifests. */
export class CheckpointManager {
  constructor(
    private workspaceRoot: string,
    private platform: Pick<PlatformAdapters, "fs" | "path" | "crypto">
  ) {}

  private get baseDir(): string {
    return this.platform.path.join(this.workspaceRoot, ".agent", "checkpoints");
  }

  async create(reason: string, runId?: string): Promise<Checkpoint> {
    const id = this.platform.crypto.randomId("cp");
    const dir = this.platform.path.join(this.baseDir, id);
    const filesRoot = this.platform.path.join(dir, "files");
    const manifest: Checkpoint["manifest"] = [];
    await this.copyTree(this.workspaceRoot, filesRoot, filesRoot, manifest);
    await this.platform.fs.mkdir(dir);
    const checkpoint: Checkpoint = {
      id,
      projectId: this.platform.path.basename(this.workspaceRoot),
      runId: runId ?? null,
      reason,
      manifest,
      createdAt: new Date().toISOString(),
    };
    await this.platform.fs.writeText(this.platform.path.join(dir, "checkpoint.json"), JSON.stringify(checkpoint, null, 2));
    return checkpoint;
  }

  async list(): Promise<Checkpoint[]> {
    if (!(await this.platform.fs.exists(this.baseDir))) return [];
    const out: Checkpoint[] = [];
    for (const entry of await this.platform.fs.list(this.baseDir)) {
      if (!entry.isDirectory) continue;
      const metadata = this.platform.path.join(entry.path, "checkpoint.json");
      if (await this.platform.fs.exists(metadata)) out.push(JSON.parse(await this.platform.fs.readText(metadata)) as Checkpoint);
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async restore(id: string): Promise<number> {
    const source = this.platform.path.join(this.baseDir, id, "files");
    if (!(await this.platform.fs.exists(source))) throw new Error(`unknown checkpoint ${id}`);
    for (const file of await this.currentFiles()) await this.platform.fs.remove(this.platform.path.join(this.workspaceRoot, file));
    return this.copyBack(source, this.workspaceRoot);
  }

  async delete(id: string): Promise<void> {
    await this.platform.fs.remove(this.platform.path.join(this.baseDir, id), true);
  }

  private async copyTree(src: string, dest: string, filesRoot: string, manifest: Checkpoint["manifest"]): Promise<void> {
    await this.platform.fs.mkdir(dest);
    let entries;
    try { entries = await this.platform.fs.list(src); } catch { return; }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name) || (entry.name === ".agent" && src === this.workspaceRoot)) continue;
      const target = this.platform.path.join(dest, entry.name);
      if (entry.isDirectory) await this.copyTree(entry.path, target, filesRoot, manifest);
      else {
        await this.platform.fs.copy(entry.path, target);
        const bytes = await this.platform.fs.readBytes(entry.path);
        manifest.push({
          relativePath: this.platform.path.relative(filesRoot, target).replace(/\\/g, "/"),
          sha256: await this.platform.crypto.sha256Bytes(bytes),
          sizeBytes: bytes.byteLength,
        });
      }
    }
  }

  private async copyBack(src: string, dest: string): Promise<number> {
    let count = 0;
    for (const entry of await this.platform.fs.list(src)) {
      const target = this.platform.path.join(dest, entry.name);
      if (entry.isDirectory) count += await this.copyBack(entry.path, target);
      else { await this.platform.fs.copy(entry.path, target); count++; }
    }
    return count;
  }

  private async currentFiles(): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string, rel: string): Promise<void> => {
      let entries;
      try { entries = await this.platform.fs.list(dir); } catch { return; }
      for (const entry of entries) {
        if (entry.isDirectory) {
          if (SKIP_DIRS.has(entry.name) || (entry.name === ".agent" && dir === this.workspaceRoot)) continue;
          await walk(entry.path, rel ? `${rel}/${entry.name}` : entry.name);
        } else out.push(rel ? `${rel}/${entry.name}` : entry.name);
      }
    };
    await walk(this.workspaceRoot, "");
    return out;
  }
}
