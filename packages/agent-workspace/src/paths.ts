/**
 * Workspace path security.
 *
 * All workspace file tools resolve paths against a project root and MUST
 * never escape it. This module is the single choke point for that rule.
 */
import path from "node:path";
import { AgentError } from "@agentmoataz/agent-protocol";

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB per-file limit

/** Normalize a user-supplied relative path and reject any escape attempt.
 *  The empty string (or ".") refers to the project root itself. */
export function safeJoin(root: string, relativePath: string): string {
  if (typeof relativePath !== "string" || !relativePath.trim()) {
    if (relativePath === "") return path.resolve(root);
    throw new AgentError({
      code: "INVALID_TOOL_ARGUMENT",
      category: "argument",
      message: "path must be a non-empty string",
      recoverable: false,
      retryable: false,
    });
  }

  // Reject absolute paths and windows drive prefixes outright.
  if (path.isAbsolute(relativePath) || /^[a-zA-Z]:[\\/]/.test(relativePath)) {
    throw escapeError(relativePath);
  }

  const normalized = path.normalize(relativePath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized) || normalized.includes(path.sep + "..")) {
    throw escapeError(relativePath);
  }

  const resolved = path.resolve(root, normalized);
  const resolvedRoot = path.resolve(root) + path.sep;
  if (!resolved.startsWith(resolvedRoot) && resolved !== path.resolve(root)) {
    throw escapeError(relativePath);
  }
  return resolved;
}

export function maxFileBytes(): number {
  return MAX_FILE_BYTES;
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
