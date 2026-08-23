/**
 * ToolRegistry — every capability the agent can invoke is a Tool here.
 * Flow: MODEL -> VALIDATE -> CAPABILITY -> PERMISSION -> EXECUTE ->
 *       VALIDATE RESULT -> PERSIST -> EVENT. No tool bypasses permissions.
 */
import { z } from "zod";
import type { PermissionCategory } from "@agentmoataz/agent-protocol";
import { AgentError } from "@agentmoataz/agent-protocol";

export interface ToolContext {
  runId: string;
  stepId?: string;
  signal?: AbortSignal;
  /** Absolute project workspace root (empty string when unavailable). */
  workspaceRoot?: string;
}

export interface Tool<I = unknown, O = unknown> {
  name: string;
  description: string;
  permissionCategory: PermissionCategory;
  inputSchema: z.ZodType<I>;
  /** Per-tool timeout in ms (default 30s). */
  timeoutMs?: number;
  execute(input: I, ctx: ToolContext): Promise<O>;
}

export class ToolRegistry {
  private tools = new Map<string, Tool<never, never>>();

  register<I, O>(tool: Tool<I, O>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`duplicate tool registration: ${tool.name}`);
    }
    this.tools.set(tool.name, tool as unknown as Tool<never, never>);
  }

  get(name: string): Tool {
    const t = this.tools.get(name);
    if (!t) {
      throw new AgentError({
        code: "CAPABILITY_UNAVAILABLE",
        category: "capability",
        message: `unknown tool "${name}"`,
        recoverable: false,
        retryable: false,
      });
    }
    return t as unknown as Tool;
  }

  list(): Tool[] {
    return [...this.tools.values()] as unknown as Tool[];
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }
}
