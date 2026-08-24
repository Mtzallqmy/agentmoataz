export interface FileSystemEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  sizeBytes: number;
}

export interface FileSystemStat {
  isDirectory: boolean;
  sizeBytes: number;
  modifiedAtMs: number;
}

export interface FileSystemAdapter {
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  writeText(path: string, content: string): Promise<void>;
  writeBytes(path: string, content: Uint8Array): Promise<void>;
  mkdir(path: string): Promise<void>;
  remove(path: string, recursive?: boolean): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  list(path: string): Promise<FileSystemEntry[]>;
  stat(path: string): Promise<FileSystemStat>;
  exists(path: string): Promise<boolean>;
}

export interface PathAdapter {
  join(...parts: string[]): string;
  basename(path: string): string;
  dirname(path: string): string;
  normalize(path: string): string;
  relative(from: string, to: string): string;
  isAbsolute(path: string): boolean;
}

export interface CryptoAdapter {
  randomId(prefix?: string): string;
  sha256Text(content: string): Promise<string>;
  sha256Bytes(content: Uint8Array): Promise<string>;
}

export interface RuntimeAdapter {
  now(): number;
  platform: "node" | "android" | "ios" | "web" | "unknown";
  tempDirectory: string;
  appDataDirectory: string;
}

export interface SecureSecretAdapter {
  storeSecret(ref: string, value: string): Promise<void>;
  resolveSecret(ref: string): Promise<string | null>;
  deleteSecret(ref: string): Promise<void>;
}

export interface PlatformAdapters {
  fs: FileSystemAdapter;
  path: PathAdapter;
  crypto: CryptoAdapter;
  runtime: RuntimeAdapter;
  secrets?: SecureSecretAdapter;
}

export const portableCrypto: CryptoAdapter = {
  randomId(prefix = "id") {
    const bytes = new Uint8Array(8);
    globalThis.crypto?.getRandomValues?.(bytes);
    if (bytes.every((value) => value === 0)) {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    const suffix = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
    return `${prefix}-${Date.now()}-${suffix}`;
  },
  async sha256Text(content) {
    return this.sha256Bytes(new TextEncoder().encode(content));
  },
  async sha256Bytes(content) {
    if (!globalThis.crypto?.subtle) throw new Error("SHA-256 capability unavailable");
    const digest = await globalThis.crypto.subtle.digest("SHA-256", content.slice().buffer as ArrayBuffer);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  },
};

export const portableRuntime: RuntimeAdapter = {
  now: () => Date.now(),
  platform: "unknown",
  tempDirectory: "",
  appDataDirectory: "",
};

/** Portable slash-based paths used by Expo and tests. */
export const portablePath: PathAdapter = {
  join(...parts) {
    return normalizePortable(parts.filter(Boolean).join("/"));
  },
  basename(value) {
    const normalized = normalizePortable(value).replace(/\/$/, "");
    return normalized.slice(normalized.lastIndexOf("/") + 1);
  },
  dirname(value) {
    const normalized = normalizePortable(value).replace(/\/$/, "");
    const index = normalized.lastIndexOf("/");
    return index <= 0 ? (normalized.startsWith("/") ? "/" : ".") : normalized.slice(0, index);
  },
  normalize: normalizePortable,
  relative(from, to) {
    const a = normalizePortable(from).split("/").filter(Boolean);
    const b = normalizePortable(to).split("/").filter(Boolean);
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    return [...Array(a.length - i).fill(".."), ...b.slice(i)].join("/") || ".";
  },
  isAbsolute(value) {
    return value.startsWith("/") || /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value) || /^[a-zA-Z]:[\\/]/.test(value);
  },
};

function normalizePortable(value: string): string {
  const scheme = value.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)/)?.[1] ?? "";
  const body = scheme ? value.slice(scheme.length) : value.replace(/\\/g, "/");
  const absolute = !scheme && body.startsWith("/");
  const out: string[] = [];
  for (const part of body.split("/")) {
    if (!part || part === ".") continue;
    if (part === ".." && out.length && out.at(-1) !== "..") out.pop();
    else if (part === ".." && !absolute) out.push(part);
    else if (part !== "..") out.push(part);
  }
  return `${scheme}${absolute ? "/" : ""}${out.join("/")}` || (absolute ? "/" : ".");
}

export { createExpoPlatform, type ExpoFileSystemLike, type ExpoSecureStoreLike } from "./expo.js";
