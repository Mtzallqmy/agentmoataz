/**
 * ArtifactManager — indexes produced artifacts with checksums and metadata.
 */
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import type { Artifact, ArtifactType } from "@agentmoataz/agent-protocol";

export class ArtifactManager {
  private artifacts: Artifact[] = [];
  private seq = 0;

  async register(init: {
    projectId: string;
    taskId?: string | null;
    type: ArtifactType;
    absolutePath: string;
    mime?: string;
    provider?: string;
  }): Promise<Artifact> {
    const buf = await fsp.readFile(init.absolutePath);
    const artifact: Artifact = {
      id: `art-${Date.now()}-${++this.seq}`,
      projectId: init.projectId,
      taskId: init.taskId ?? null,
      type: init.type,
      path: init.absolutePath,
      mime: init.mime ?? guessMime(init.absolutePath),
      provider: init.provider ?? "local",
      checksumSha256: crypto.createHash("sha256").update(buf).digest("hex"),
      sizeBytes: buf.length,
      createdAt: new Date().toISOString(),
    };
    this.artifacts.push(artifact);
    return artifact;
  }

  list(projectId?: string): readonly Artifact[] {
    return projectId ? this.artifacts.filter((a) => a.projectId === projectId) : this.artifacts;
  }

  get(id: string): Artifact | undefined {
    return this.artifacts.find((a) => a.id === id);
  }

  /** Verify stored checksum still matches the file on disk. */
  async verify(id: string): Promise<boolean> {
    const a = this.get(id);
    if (!a || !a.checksumSha256) return false;
    try {
      const buf = await fsp.readFile(a.path);
      return crypto.createHash("sha256").update(buf).digest("hex") === a.checksumSha256;
    } catch {
      return false;
    }
  }
}

function guessMime(p: string): string {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "zip": return "application/zip";
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "mp4": return "video/mp4";
    case "md": return "text/markdown";
    case "pdf": return "application/pdf";
    default: return "application/octet-stream";
  }
}
