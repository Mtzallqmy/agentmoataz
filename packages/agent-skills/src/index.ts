/**
 * agent-skills — loads skill definitions from skills/<name>/SKILL.md +
 * metadata.json. Skills are data; their content never bypasses permissions.
 */
import { z } from "zod";
import type { SkillRecord } from "@agentmoataz/agent-protocol";
import type { PlatformAdapters } from "@agentmoataz/agent-platform";

export const SkillMetadataSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  purpose: z.string().min(1),
  triggers: z.array(z.string()).default([]),
  prerequisites: z.array(z.string()).default([]),
  steps: z.array(z.string()).min(1),
  allowedTools: z.array(z.string()).default([]),
  validation: z.array(z.string()).default([]),
  recovery: z.string().default("restore latest checkpoint"),
});
export type SkillMetadata = z.infer<typeof SkillMetadataSchema>;

export interface LoadedSkill {
  record: SkillRecord;
  metadata: SkillMetadata;
  markdown: string;
}

export class SkillManager {
  private skills = new Map<string, LoadedSkill>();

  constructor(private platform: Pick<PlatformAdapters, "fs" | "path">) {}

  /** Load all skills under a root directory (skills/). Non-recursive per skill dir. */
  async loadFrom(rootDir: string): Promise<number> {
    let entries;
    try {
      entries = await this.platform.fs.list(rootDir);
    } catch {
      return 0;
    }
    for (const category of entries.filter((entry) => entry.isDirectory)) {
      const catDir = this.platform.path.join(rootDir, category.name);
      let catEntries;
      try {
        catEntries = await this.platform.fs.list(catDir);
      } catch {
        continue;
      }
      for (const dir of catEntries.filter((entry) => entry.isDirectory)) {
        await this.loadSkill(this.platform.path.join(catDir, dir.name)).catch(() => undefined);
      }
    }
    return this.skills.size;
  }

  async loadSkill(dir: string): Promise<LoadedSkill> {
    const metaRaw = await this.platform.fs.readText(this.platform.path.join(dir, "metadata.json"));
    const parsedMeta = JSON.parse(metaRaw);
    // tolerate both {"skill": {...}} and flat metadata
    const candidate =
      typeof parsedMeta === "object" && parsedMeta !== null && "skill" in (parsedMeta as object)
        ? (parsedMeta as { skill: unknown }).skill
        : parsedMeta;
    const metadata = SkillMetadataSchema.parse(candidate);
    const markdownPath = this.platform.path.join(dir, "SKILL.md");
    const markdown = (await this.platform.fs.exists(markdownPath)) ? await this.platform.fs.readText(markdownPath) : "";
    const skill: LoadedSkill = {
      metadata,
      markdown,
      record: {
        name: metadata.name,
        purpose: metadata.purpose,
        triggers: metadata.triggers,
        allowedTools: metadata.allowedTools,
        enabled: true,
      },
    };
    this.skills.set(metadata.name, skill);
    return skill;
  }

  register(skill: LoadedSkill): void {
    this.skills.set(skill.metadata.name, skill);
  }

  list(): readonly LoadedSkill[] {
    return [...this.skills.values()];
  }

  enabled(): LoadedSkill[] {
    return this.list().filter((s) => s.record.enabled);
  }

  get(name: string): LoadedSkill | undefined {
    return this.skills.get(name);
  }

  setEnabled(name: string, enabled: boolean): boolean {
    const s = this.skills.get(name);
    if (!s) return false;
    s.record.enabled = enabled;
    return true;
  }

  /** Skills triggered by a user goal (keyword match on triggers/purpose). */
  match(goal: string): LoadedSkill[] {
    const g = goal.toLowerCase();
    return this.enabled().filter((s) =>
      s.record.triggers.some((t) => g.includes(t.toLowerCase())) ||
      g.includes(s.record.name.toLowerCase())
    );
  }
}
