import type { Artifact, ArtifactType } from "@agentmoataz/agent-protocol";
import type { PlatformAdapters } from "@agentmoataz/agent-platform";

export class ArtifactManager {
  private artifacts: Artifact[] = [];

  constructor(private platform: Pick<PlatformAdapters, "fs" | "crypto">) {}

  async register(init: {
    projectId: string;
    taskId?: string | null;
    type: ArtifactType;
    absolutePath: string;
    mime?: string;
    provider?: string;
  }): Promise<Artifact> {
    const bytes = await this.platform.fs.readBytes(init.absolutePath);
    const artifact: Artifact = {
      id: this.platform.crypto.randomId("art"),
      projectId: init.projectId,
      taskId: init.taskId ?? null,
      type: init.type,
      path: init.absolutePath,
      mime: init.mime ?? guessMime(init.absolutePath),
      provider: init.provider ?? "local",
      checksumSha256: await this.platform.crypto.sha256Bytes(bytes),
      sizeBytes: bytes.byteLength,
      createdAt: new Date().toISOString(),
    };
    this.artifacts.push(artifact);
    return artifact;
  }

  list(projectId?: string): readonly Artifact[] {
    return projectId ? this.artifacts.filter((artifact) => artifact.projectId === projectId) : this.artifacts;
  }

  get(id: string): Artifact | undefined {
    return this.artifacts.find((artifact) => artifact.id === id);
  }

  async verify(id: string): Promise<boolean> {
    const artifact = this.get(id);
    if (!artifact?.checksumSha256) return false;
    try {
      const checksum = await this.platform.crypto.sha256Bytes(await this.platform.fs.readBytes(artifact.path));
      return checksum === artifact.checksumSha256;
    } catch {
      return false;
    }
  }
}

function guessMime(path: string): string {
  switch (path.split(".").pop()?.toLowerCase() ?? "") {
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
