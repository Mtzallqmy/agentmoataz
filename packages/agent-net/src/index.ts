/**
 * agent-net — network tools with hard limits. All downloaded/fetched content
 * is UNTRUSTED data; it never becomes instructions.
 *
 * React Native fetch does not consistently expose a WHATWG ReadableStream,
 * so response bodies are decoded from ArrayBuffer rather than getReader().
 */
import { z } from "zod";
import { AgentError } from "@agentmoataz/agent-protocol";
import type { Tool } from "@agentmoataz/agent-core";
import { utf8Decode, type PlatformAdapters } from "@agentmoataz/agent-platform";

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
  } catch (error) {
    if (signal?.aborted) {
      throw new AgentError({ code: "TOOL_CANCELLED", category: "tool", message: "network request cancelled", recoverable: true, retryable: false });
    }
    throw new AgentError({
      code: "NETWORK_UNAVAILABLE",
      category: "network",
      message: error instanceof Error ? error.message : "network request failed",
      recoverable: true,
      retryable: true,
      technicalCause: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Follow redirects manually with a cap. */
async function fetchWithLimits(url: string, method: string, headers: Record<string, string>, body?: string, signal?: AbortSignal): Promise<Response> {
  let current = url;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const res = await boundedFetch(current, { method, headers, ...(body !== undefined ? { body } : {}) }, signal);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel?.().catch(() => undefined);
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
  const announced = Number(res.headers.get("content-length") ?? "0");
  const bytes = new Uint8Array(await res.arrayBuffer());
  const truncated = bytes.byteLength > MAX_RESPONSE_BYTES || (Number.isFinite(announced) && announced > MAX_RESPONSE_BYTES);
  return {
    text: utf8Decode(truncated ? bytes.slice(0, MAX_RESPONSE_BYTES) : bytes),
    truncated,
  };
}

export function buildHttpTools(platform?: Pick<PlatformAdapters, "fs" | "path">): Tool[] {
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
      const res = await fetchWithLimits(input.url, input.method, input.headers ?? {}, input.body, ctx.signal);
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
      if (!platform) {
        throw new AgentError({ code: "CAPABILITY_UNAVAILABLE", category: "capability", message: "download filesystem adapter unavailable", recoverable: false, retryable: false });
      }
      const safeName = platform.path.basename(input.fileName).replace(/[^\w.\-]+/g, "_");
      if (!safeName || safeName === "." || safeName === "..") {
        throw new AgentError({ code: "INVALID_TOOL_ARGUMENT", category: "argument", message: "invalid file name", recoverable: false, retryable: false });
      }
      const workspaceRoot = ctx.workspaceRoot;
      if (!workspaceRoot) {
        throw new AgentError({ code: "CAPABILITY_UNAVAILABLE", category: "capability", message: "workspace root unavailable", recoverable: false, retryable: false });
      }
      const destDir = platform.path.join(workspaceRoot, "exports");
      await platform.fs.mkdir(destDir);
      const dest = platform.path.join(destDir, safeName);

      const res = await fetchWithLimits(input.url, "GET", {}, undefined, ctx.signal);
      if (!res.ok) {
        throw new AgentError({
          code: "NETWORK_UNAVAILABLE",
          category: "network",
          message: `download returned HTTP ${res.status}`,
          recoverable: res.status >= 500,
          retryable: res.status >= 500,
        });
      }
      const announced = Number(res.headers.get("content-length") ?? "0");
      if (Number.isFinite(announced) && announced > MAX_RESPONSE_BYTES) {
        throw new AgentError({ code: "INVALID_TOOL_ARGUMENT", category: "network", message: `download exceeds ${MAX_RESPONSE_BYTES} byte limit`, recoverable: false, retryable: false });
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > MAX_RESPONSE_BYTES) {
        throw new AgentError({ code: "INVALID_TOOL_ARGUMENT", category: "network", message: `download exceeds ${MAX_RESPONSE_BYTES} byte limit`, recoverable: false, retryable: false });
      }
      await platform.fs.writeBytes(dest, bytes);
      return { path: platform.path.relative(workspaceRoot, dest), sizeBytes: bytes.byteLength };
    },
  };

  return [httpGet, httpRequest, downloadFile];
}
