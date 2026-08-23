/**
 * agent-skills — loads skill definitions from skills/<name>/SKILL.md +
 * metadata.json. Skills are data; their content never bypasses permissions.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { SkillRecord } from "@agentmoataz/agent-protocol";

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

  /** Load all skills under a root directory (skills/). Non-recursive per skill dir. */
  async loadFrom(rootDir: string): Promise<number> {
    let entries;
    try {
      entries = await fsp.readdir(rootDir, { withFileTypes: true });
    } catch {
      return 0;
    }
    for (const category of entries.filter((e) => e.isDirectory())) {
      const catDir = path.join(rootDir, category.name);
      let catEntries;
      try {
        catEntries = await fsp.readdir(catDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const dir of catEntries.filter((e) => e.isDirectory())) {
        await this.loadSkill(path.join(catDir, dir.name)).catch(() => undefined);
      }
    }
    return this.skills.size;
  }

  async loadSkill(dir: string): Promise<LoadedSkill> {
    const metaRaw = await fsp.readFile(path.join(dir, "metadata.json"), "utf8");
    const parsedMeta = JSON.parse(metaRaw);
    // tolerate both {"skill": {...}} and flat metadata
    const candidate =
      typeof parsedMeta === "object" && parsedMeta !== null && "skill" in (parsedMeta as object)
        ? (parsedMeta as { skill: unknown }).skill
        : parsedMeta;
    const metadata = SkillMetadataSchema.parse(candidate);
    const markdown = await fsp.readFile(path.join(dir, "SKILL.md"), "utf8").catch(() => "");
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
