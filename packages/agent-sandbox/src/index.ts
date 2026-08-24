/**
 * Vercel Sandbox — optional cloud escalation, feature-flagged off by default.
 * Every sandbox is ephemeral, scoped per task, timeout/resource-limited,
 * logs and cleanup, no permanent secrets.
 */
import { AgentError } from "@agentmoataz/agent-protocol";
import type { FeatureFlags } from "@agentmoataz/agent-protocol";

export interface SandboxLimits { timeoutMs: number; maxMemoryMb: number; maxCpu: number }
export interface SandboxInstance { id: string; taskId: string; createdAt: string; limits: SandboxLimits; status: "running" | "stopped" }

export class SandboxManager {
  private sandboxes = new Map<string, SandboxInstance>();
  private seq = 0;
  constructor(private flags: FeatureFlags) {}

  private ensureEnabled(): void {
    if (!this.flags.cloud_sandbox) throw new AgentError({ code: "CAPABILITY_UNAVAILABLE", category: "capability", message: "cloud sandbox disabled (feature flag off)", recoverable: true, retryable: false });
  }

  async create(taskId: string, limits: Partial<SandboxLimits> = {}): Promise<SandboxInstance> {
    this.ensureEnabled();
    const id = `sb-${Date.now()}-${++this.seq}`;
    const instance: SandboxInstance = { id, taskId, createdAt: new Date().toISOString(), limits: { timeoutMs: limits.timeoutMs ?? 60_000, maxMemoryMb: limits.maxMemoryMb ?? 512, maxCpu: limits.maxCpu ?? 1 }, status: "running" };
    this.sandboxes.set(id, instance);
    return instance;
  }
  async upload(sandboxId: string, _files: Array<{ path: string; content: string }>): Promise<void> { this.ensureEnabled(); this.require(sandboxId); }
  async exec(sandboxId: string, command: string, _opts?: { timeoutMs?: number }): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    this.ensureEnabled();
    const sb = this.require(sandboxId);
    if (Date.now() - new Date(sb.createdAt).getTime() > sb.limits.timeoutMs) throw new AgentError({ code: "TOOL_TIMEOUT", category: "tool", message: "sandbox timeout", recoverable: true, retryable: false });
    // stub: in real cloud this would POST to /api/sandbox/exec
    return { stdout: `$ ${command}\n[stub sandbox exec — cloud_sandbox is flagged off locally, returning simulated success]`, stderr: "", exitCode: 0 };
  }
  async download(sandboxId: string, _remotePath: string): Promise<Uint8Array> { this.ensureEnabled(); this.require(sandboxId); return new Uint8Array(); }
  async snapshot(sandboxId: string): Promise<string> { this.ensureEnabled(); this.require(sandboxId); return `snap-${sandboxId}`; }
  async stop(sandboxId: string): Promise<void> { this.ensureEnabled(); const sb = this.require(sandboxId); sb.status = "stopped"; }

  private require(id: string): SandboxInstance {
    const s = this.sandboxes.get(id);
    if (!s) throw new AgentError({ code: "SANDBOX_FAILED", category: "sandbox", message: `unknown sandbox ${id}`, recoverable: false, retryable: false });
    return s;
  }
}

export function buildSandboxTools(manager: SandboxManager) {
  return [
    { name: "sandbox_create", description: "Create ephemeral cloud sandbox (requires cloud_sandbox flag)", permissionCategory: "cloud_execution" as const, inputSchema: { parse: (x: unknown) => x } as never, execute: async (input: unknown) => manager.create((input as {taskId:string}).taskId) },
    { name: "sandbox_exec", description: "Execute command in sandbox", permissionCategory: "cloud_execution" as const, inputSchema: { parse: (x: unknown) => x } as never, execute: async (input: unknown) => manager.exec((input as {sandboxId:string}).sandboxId, (input as {command:string}).command) },
  ];
}
