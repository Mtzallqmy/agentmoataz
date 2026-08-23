/**
 * agent-mcp — remote MCP adapter.
 *
 * MCP is an adapter INTO the ToolRegistry, never a bypass: every discovered
 * tool is registered with a permission category and passes through the
 * PermissionEngine like any built-in tool.
 *
 * Implements a minimal JSON-RPC 2.0 client for the standard MCP methods:
 * initialize / tools/list / tools/call over HTTP POST (streamable transport).
 */
import { z } from "zod";
import type { PermissionCategory } from "@agentmoataz/agent-protocol";
import { AgentError } from "@agentmoataz/agent-protocol";
import type { Tool, ToolRegistry, ToolContext } from "@agentmoataz/agent-core";

const JsonRpcResponse = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.number(), z.string()]).nullable(),
  result: z.unknown().optional(),
  error: z
    .object({ code: z.number(), message: z.string() })
    .optional(),
});

const ToolsListResult = z.object({
  tools: z.array(
    z.object({
      name: z.string().min(1),
      description: z.string().default(""),
      inputSchema: z.record(z.unknown()).default({}),
    })
  ),
});

export type McpPermissionMapper = (toolName: string) => PermissionCategory;

/** Default mapping is conservative: unknown tools require explicit approval. */
export const defaultPermissionMapper: McpPermissionMapper = () => "execute_code";

export class McpClient {
  private nextId = 0;

  constructor(
    readonly serverUrl: string,
    private options?: {
      headers?: Record<string, string>;
      permissionMapper?: McpPermissionMapper;
      timeoutMs?: number;
    }
  ) {}

  private async rpc(method: string, params?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error("timeout")),
      this.options?.timeoutMs ?? 15_000
    );
    let res: Response;
    try {
      res = await fetch(this.serverUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(this.options?.headers ?? {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: ++this.nextId,
          method,
          ...(params !== undefined ? { params } : {}),
        }),
        signal: controller.signal,
      });
    } catch (e) {
      throw new AgentError({
        code: "NETWORK_UNAVAILABLE",
        category: "network",
        message: `MCP server unreachable: ${this.serverUrl}`,
        recoverable: true,
        retryable: true,
        technicalCause: e instanceof Error ? e.message : String(e),
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new AgentError({
        code: "SANDBOX_FAILED",
        category: "sandbox",
        message: `MCP server returned ${res.status}`,
        recoverable: true,
        retryable: res.status >= 500,
        technicalCause: await res.text().catch(() => ""),
      });
    }

    // Tolerate SSE-framed single responses as well as plain JSON.
    const raw = await res.text();
    const jsonLine =
      raw.startsWith("{") ? raw : raw.split("\n").find((l) => l.startsWith("data:"))?.slice(5).trim() ?? raw;
    const parsed = JsonRpcResponse.safeParse(JSON.parse(jsonLine));
    if (!parsed.success) {
      throw new AgentError({
        code: "SANDBOX_FAILED",
        category: "sandbox",
        message: "malformed JSON-RPC response from MCP server",
        recoverable: false,
        retryable: false,
      });
    }
    if (parsed.data.error) {
      throw new AgentError({
        code: "INVALID_TOOL_ARGUMENT",
        category: "argument",
        message: `MCP error ${parsed.data.error.code}: ${parsed.data.error.message}`,
        recoverable: false,
        retryable: false,
      });
    }
    return parsed.data.result ?? {};
  }

  async initialize(): Promise<{ serverInfo: Record<string, unknown> }> {
    const result = (await this.rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "agentmoataz", version: "0.1.0" },
    })) as { serverInfo?: Record<string, unknown> };
    return { serverInfo: result.serverInfo ?? {} };
  }

  async listTools(): Promise<Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>> {
    const result = ToolsListResult.parse(await this.rpc("tools/list"));
    return result.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = (await this.rpc("tools/call", { name, arguments: args })) as {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };
    if (result.isError) {
      throw new AgentError({
        code: "TOOL_TIMEOUT",
        category: "tool",
        message: `MCP tool "${name}" reported isError`,
        recoverable: false,
        retryable: false,
      });
    }
    return (result.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n");
  }

  /** Discover remote tools and register them into the ToolRegistry (permission-gated). */
  async registerInto(registry: ToolRegistry): Promise<number> {
    const mapper = this.options?.permissionMapper ?? defaultPermissionMapper;
    const tools = await this.listTools();
    for (const t of tools) {
      const toolName = `mcp_${t.name}`;
      const remote = this;
      const proxy: Tool<Record<string, unknown>, { text: string }> = {
        name: toolName,
        description: `[MCP] ${t.description}`,
        permissionCategory: mapper(t.name),
        timeoutMs: this.options?.timeoutMs,
        inputSchema: z.object({}).passthrough() as unknown as z.ZodType<Record<string, unknown>>,
        async execute(input: Record<string, unknown>, _ctx: ToolContext) {
          return { text: await remote.callTool(t.name, input) };
        },
      };
      if (!registry.has(toolName)) registry.register(proxy);
    }
    return tools.length;
  }
}
