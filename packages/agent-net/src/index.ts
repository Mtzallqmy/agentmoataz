/**
 * agent-net — network tools with hard limits. All downloaded/fetched content
 * is UNTRUSTED data; it never becomes instructions.
 *
 * - http_get / http_request: response size caps, redirect caps, timeout,
 *   cancellation, permission gating happens in the caller (ToolRegistry).
 */
import { z } from "zod";
import { AgentError } from "@agentmoataz/agent-protocol";
import type { Tool } from "@agentmoataz/agent-core";
import fsp from "node:fs/promises";
import path from "node:path";

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 20_000;

export interface HttpResult {
  status: number;
  contentType: string;
  body: string;
  bytesTruncated: boolean;
}

async function boundedFetch(
  url: string,
  init: RequestInit & { redirect?: "follow" | "manual" | "error" },
  signal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(new Error("cancelled"));
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("timeout")), DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: "manual" });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Follow redirects manually with a cap and same-size guard. */
async function fetchWithLimits(url: string, method: string, headers: Record<string, string>, body?: string, signal?: AbortSignal): Promise<Response> {
  let current = url;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const res = await boundedFetch(current, { method, headers, ...(body !== undefined ? { body } : {}) }, signal);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel().catch(() => undefined);
      if (!loc) throw new AgentError({
        code: "NETWORK_UNAVAILABLE", category: "network",
        message: `redirect without location at step ${i}`, recoverable: false, retryable: false,
      });
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  throw new AgentError({
    code: "NETWORK_UNAVAILABLE", category: "network",
    message: `too many redirects (>${MAX_REDIRECTS})`, recoverable: false, retryable: false,
  });
}

async function readBounded(res: Response): Promise<{ text: string; truncated: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) return { text: "", truncated: false };
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value!.length;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      return { text, truncated: true };
    }
    text += decoder.decode(value!, { stream: true });
  }
  return { text: text + decoder.decode(), truncated: false };
}

export function buildHttpTools(): Tool[] {
  const httpGet: Tool<{ url: string }, HttpResult> = {
    name: "http_get",
    description: "GET a URL as untrusted text data (size/redirect/timeout capped).",
    permissionCategory: "network_get",
    inputSchema: z.object({ url: z.string().url() }),
    async execute(input, ctx) {
      const res = await fetchWithLimits(input.url, "GET", {}, undefined, ctx.signal);
      const { text, truncated } = await readBounded(res);
      return {
        status: res.status,
        contentType: res.headers.get("content-type") ?? "",
        body: text,
        bytesTruncated: truncated,
      };
    },
  };

  const httpRequest: Tool<
    { url: string; method: string; headers?: Record<string, string>; body?: string },
    HttpResult
  > = {
    name: "http_request",
    description: "Perform a generic HTTP request (POST/PUT/etc.) as untrusted data.",
    permissionCategory: "network_post",
    inputSchema: z.object({
      url: z.string().url(),
      method: z.enum(["POST", "PUT", "PATCH", "DELETE"]),
      headers: z.record(z.string()).optional(),
      body: z.string().max(1024 * 1024).optional(),
    }),
    async execute(input, ctx) {
      const res = await fetchWithLimits(
        input.url,
        input.method,
        input.headers ?? {},
        input.body,
        ctx.signal
      );
      const { text, truncated } = await readBounded(res);
      return {
        status: res.status,
        contentType: res.headers.get("content-type") ?? "",
        body: text,
        bytesTruncated: truncated,
      };
    },
  };

  const downloadFile: Tool<{ url: string; fileName: string }, { path: string; sizeBytes: number }> = {
    name: "download_file",
    description: "Download a file into the workspace exports directory (safe name enforced).",
    permissionCategory: "download",
    inputSchema: z.object({ url: z.string().url(), fileName: z.string().min(1).max(120) }),
    async execute(input, ctx) {
      // safe filename: strip any path components / traversal
      const safeName = path.basename(input.fileName).replace(/[^\w.\-]+/g, "_");
      if (!safeName || safeName === "." || safeName === "..") {
        throw new AgentError({
          code: "INVALID_TOOL_ARGUMENT", category: "argument",
          message: "invalid file name", recoverable: false, retryable: false,
        });
      }
      const destDir = path.join(ctx.workspaceRoot || process.cwd(), "exports");
      await fsp.mkdir(destDir, { recursive: true });
      const dest = path.join(destDir, safeName);

      const res = await fetchWithLimits(input.url, "GET", {}, undefined, ctx.signal);
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_RESPONSE_BYTES) {
        throw new AgentError({
          code: "INVALID_TOOL_ARGUMENT", category: "network",
          message: `download exceeds ${MAX_RESPONSE_BYTES} byte limit`, recoverable: false, retryable: false,
        });
      }
      await fsp.writeFile(dest, Buffer.from(buf));
      return {
        path: path.relative(ctx.workspaceRoot || process.cwd(), dest),
        sizeBytes: buf.byteLength,
      };
    },
  };

  return [httpGet, httpRequest, downloadFile];
}
