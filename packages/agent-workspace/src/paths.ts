import type { PathAdapter } from "@agentmoataz/agent-platform";
import { AgentError } from "@agentmoataz/agent-protocol";

const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Single path-security choke point, independent of Node/Expo. */
export function safeJoin(root: string, relativePath: string, paths: PathAdapter): string {
  if (typeof relativePath !== "string" || !relativePath.trim()) {
    if (relativePath === "") return paths.normalize(root);
    throw invalidPath();
  }

  const slashPath = relativePath.replace(/\\/g, "/");
  if (
    paths.isAbsolute(relativePath) ||
    /^[a-zA-Z]:[\\/]/.test(relativePath) ||
    slashPath.split("/").includes("..") ||
    /%2e/i.test(relativePath)
  ) {
    throw escapeError(relativePath);
  }

  const normalized = paths.normalize(relativePath);
  const candidate = paths.normalize(paths.join(root, normalized));
  const normalizedRoot = paths.normalize(root).replace(/\\/g, "/").replace(/\/$/, "");
  const comparable = candidate.replace(/\\/g, "/");
  if (comparable !== normalizedRoot && !comparable.startsWith(`${normalizedRoot}/`)) {
    throw escapeError(relativePath);
  }
  return candidate;
}

export function maxFileBytes(): number {
  return MAX_FILE_BYTES;
}

function invalidPath(): AgentError {
  return new AgentError({
    code: "INVALID_TOOL_ARGUMENT",
    category: "argument",
    message: "path must be a non-empty string",
    recoverable: false,
    retryable: false,
  });
}

function escapeError(attempted: string): AgentError {
  return new AgentError({
    code: "WORKSPACE_ESCAPE_BLOCKED",
    category: "workspace",
    message: `path escapes project root: ${JSON.stringify(attempted.slice(0, 200))}`,
    recoverable: false,
    retryable: false,
  });
}
