/**
 * PermissionEngine — every tool call passes through here. No exceptions.
 *
 * Profiles:
 *  SAFE       — read-only by default; anything mutating requires approval
 *  BALANCED   — project reads/writes + GET allowed; deletes/network-post/push ask
 *  AUTONOMOUS — most things allowed; destructive/irreversible still asks
 *  CUSTOM     — user overrides on top of BALANCED
 */
import type { PermissionCategory } from "@agentmoataz/agent-protocol";
import { AgentError } from "@agentmoataz/agent-protocol";

export type ProfileName = "SAFE" | "BALANCED" | "AUTONOMOUS" | "CUSTOM";
export type Decision = "allow" | "ask" | "deny";

const READ_ONLY: PermissionCategory[] = ["read_project_file"];

const BASE: Record<ProfileName, Partial<Record<PermissionCategory, Decision>>> = {
  SAFE: {
    read_project_file: "allow",
    write_project_file: "ask",
    delete_file: "ask",
    bulk_delete: "ask",
    network_get: "ask",
    network_post: "ask",
    download: "ask",
    git_local: "allow",
    git_push: "deny",
    install_package: "ask",
    cloud_execution: "deny",
    external_file_access: "ask",
    camera_microphone: "ask",
    secret_access: "ask",
    destructive_db: "ask",
    execute_code: "ask",
  },
  BALANCED: {
    read_project_file: "allow",
    write_project_file: "allow",
    delete_file: "ask",
    bulk_delete: "ask",
    network_get: "allow",
    network_post: "ask",
    download: "ask",
    git_local: "allow",
    git_push: "ask",
    install_package: "ask",
    cloud_execution: "ask",
    external_file_access: "ask",
    camera_microphone: "ask",
    secret_access: "ask",
    destructive_db: "ask",
    execute_code: "ask",
  },
  AUTONOMOUS: {
    read_project_file: "allow",
    write_project_file: "allow",
    delete_file: "allow",
    bulk_delete: "ask",
    network_get: "allow",
    network_post: "allow",
    download: "allow",
    git_local: "allow",
    git_push: "ask",
    install_package: "allow",
    cloud_execution: "ask",
    external_file_access: "allow",
    camera_microphone: "ask",
    secret_access: "ask",
    destructive_db: "ask",
    execute_code: "allow",
  },
  CUSTOM: {}, // falls back to BALANCED then overrides
};

export interface PermissionRequestLogEntry {
  category: PermissionCategory;
  toolName: string;
  decision: Decision;
  profile: ProfileName;
  runId?: string;
  at: string;
}

export class PermissionEngine {
  private log: PermissionRequestLogEntry[] = [];

  constructor(
    public profile: ProfileName = "BALANCED",
    private customOverrides: Partial<Record<PermissionCategory, Decision>> = {}
  ) {}

  setProfile(profile: ProfileName): void {
    this.profile = profile;
  }

  setOverride(category: PermissionCategory, decision: Decision): void {
    this.customOverrides[category] = decision;
  }

  decide(category: PermissionCategory, toolName: string, runId?: string): Decision {
    const effective =
      this.profile === "CUSTOM"
        ? (this.customOverrides[category] ?? BASE.BALANCED[category])
        : (BASE[this.profile][category] ?? BASE.BALANCED[category]);

    const decision: Decision = effective ?? "ask";
    this.log.push({
      category,
      toolName,
      decision,
      profile: this.profile,
      ...(runId !== undefined ? { runId } : {}),
      at: new Date().toISOString(),
    });
    return decision;
  }

  /** Throws PERMISSION_DENIED when the decision is deny; callers handle `ask`. */
  requireAllowed(category: PermissionCategory, toolName: string, runId?: string): void {
    if (this.decide(category, toolName, runId) === "deny") {
      throw new AgentError({
        code: "PERMISSION_DENIED",
        category: "permission",
        message: `tool "${toolName}" denied by permission profile ${this.profile}`,
        recoverable: false,
        retryable: false,
      });
    }
  }

  audit(): readonly PermissionRequestLogEntry[] {
    return this.log;
  }
}
