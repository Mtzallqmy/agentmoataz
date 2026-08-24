import type { PathAdapter } from "@agentmoataz/agent-platform";
import { AgentError } from "@agentmoataz/agent-protocol";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 2000;

/** Single path-security choke point, independent of Node/Expo. */
export function safeJoin(root: string, relativePath: string, paths: PathAdapter): string {
  if (typeof relativePath !== "string") throw invalidPath();
  const nfc = relativePath.normalize("NFC");
  if (!nfc.trim()) {
    if (nfc === "" || nfc === "." || nfc === "./") return paths.normalize(root);
    throw invalidPath();
  }
  if (nfc.includes("\0") || /[\x00-\x1f\x7f]/.test(nfc)) throw escapeError(nfc);
  const slashPath = nfc.replace(/\\/g, "/");
  if (
    paths.isAbsolute(nfc) ||
    /^[a-zA-Z]:[\\/]/.test(nfc) ||
    slashPath.split("/").includes("..") ||
    /%2e/i.test(nfc) ||
    (/%2f/i.test(nfc) && slashPath.includes("%2f"))
  ) throw escapeError(nfc);
  try {
    const decoded = decodeURIComponent(nfc);
    if (decoded !== nfc && (decoded.includes("..") || decoded.includes("\0") || paths.isAbsolute(decoded))) throw escapeError(nfc);
  } catch {
    if (/%[0-9a-f]{2}/i.test(nfc)) throw escapeError(nfc);
  }
  const normalized = paths.normalize(slashPath);
  const candidate = paths.normalize(paths.join(root, normalized));
  const normalizedRoot = paths.normalize(root).replace(/\\/g, "/").replace(/\/$/, "");
  const comparable = candidate.replace(/\\/g, "/");
  if (comparable !== normalizedRoot && !comparable.startsWith(`${normalizedRoot}/`)) throw escapeError(nfc);
  return candidate;
}

export function safeArchiveEntryName(entryName: string): string {
  const nfc = entryName.normalize("NFC").replace(/\\/g, "/");
  if (!nfc || nfc.includes("\0") || /[\x00-\x1f\x7f]/.test(nfc)) throw escapeError(entryName);
  if (nfc.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(nfc) || nfc.split("/").includes("..") || nfc.includes("//")) throw escapeError(entryName);
  const normalized = nfc.replace(/\/$/, "").split("/").filter(Boolean).join("/");
  if (!normalized || normalized.startsWith("..") || normalized.includes("/../")) throw escapeError(entryName);
  return normalized;
}

export function safeFilename(name: string): string {
  const nfc = name.normalize("NFC").trim();
  if (!nfc || nfc.includes("/") || nfc.includes("\\") || nfc.includes("\0")) throw invalidPath();
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(nfc)) throw invalidPath();
  if (/[\x00-\x1f\x7f]/.test(nfc)) throw invalidPath();
  const cleaned = nfc.replace(/[\x00-\x1f\x7f]/g, "");
  if (!cleaned || cleaned.endsWith(".") || cleaned.endsWith(" ")) throw invalidPath();
  if (cleaned.length > 255) throw invalidPath();
  return cleaned;
}

export function maxFileBytes(): number { return MAX_FILE_BYTES; }
export function maxArchiveBytes(): number { return MAX_ARCHIVE_BYTES; }
export function maxArchiveEntries(): number { return MAX_ARCHIVE_ENTRIES; }

function invalidPath(): AgentError {
  return new AgentError({ code: "INVALID_TOOL_ARGUMENT", category: "argument", message: "path must be a non-empty string", recoverable: false, retryable: false });
}
function escapeError(attempted: string): AgentError {
  return new AgentError({ code: "WORKSPACE_ESCAPE_BLOCKED", category: "workspace", message: `path escapes project root: ${JSON.stringify(attempted.slice(0, 200))}`, recoverable: false, retryable: false });
}
