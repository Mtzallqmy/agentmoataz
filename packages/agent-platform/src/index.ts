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

/** UTF-8 helpers that work on Hermes even when TextEncoder/TextDecoder are absent. */
export function utf8Encode(value: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < value.length; i++) {
    let code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const low = value.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        i++;
      }
    }
    if (code <= 0x7f) out.push(code);
    else if (code <= 0x7ff) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code <= 0xffff) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return new Uint8Array(out);
}

export function utf8Decode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const a = bytes[i++]!;
    if (a < 0x80) {
      out += String.fromCharCode(a);
      continue;
    }
    if ((a & 0xe0) === 0xc0 && i < bytes.length) {
      const b = bytes[i++]!;
      const code = ((a & 0x1f) << 6) | (b & 0x3f);
      out += code >= 0x80 ? String.fromCharCode(code) : "\ufffd";
      continue;
    }
    if ((a & 0xf0) === 0xe0 && i + 1 < bytes.length) {
      const b = bytes[i++]!;
      const c = bytes[i++]!;
      const code = ((a & 0x0f) << 12) | ((b & 0x3f) << 6) | (c & 0x3f);
      out += code >= 0x800 && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCharCode(code) : "\ufffd";
      continue;
    }
    if ((a & 0xf8) === 0xf0 && i + 2 < bytes.length) {
      const b = bytes[i++]!;
      const c = bytes[i++]!;
      const d = bytes[i++]!;
      const code = ((a & 0x07) << 18) | ((b & 0x3f) << 12) | ((c & 0x3f) << 6) | (d & 0x3f);
      if (code >= 0x10000 && code <= 0x10ffff) {
        const value = code - 0x10000;
        out += String.fromCharCode(0xd800 + (value >> 10), 0xdc00 + (value & 0x3ff));
      } else out += "\ufffd";
      continue;
    }
    out += "\ufffd";
  }
  return out;
}

export const portableCrypto: CryptoAdapter = {
  randomId(prefix = "id") {
    const bytes = new Uint8Array(8);
    const cryptoApi = globalThis.crypto;
    if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    const suffix = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
    return `${prefix}-${Date.now()}-${suffix}`;
  },
  async sha256Text(content) {
    return this.sha256Bytes(utf8Encode(content));
  },
  async sha256Bytes(content) {
    const subtle = globalThis.crypto?.subtle;
    if (subtle) {
      try {
        const copy = content.slice();
        const digest = await subtle.digest("SHA-256", copy.buffer as ArrayBuffer);
        return bytesToHex(new Uint8Array(digest));
      } catch {
        // Hermes/WebView implementations may expose crypto.subtle incompletely.
      }
    }
    return sha256Fallback(content);
  },
};

export const portableRuntime: RuntimeAdapter = {
  now: () => Date.now(),
  platform: "unknown",
  tempDirectory: "",
  appDataDirectory: "",
};

/** Portable slash-based paths used by Expo and tests. Preserves URI schemes such as file:///. */
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
    const schemeEnd = normalized.indexOf("://") >= 0 ? normalized.indexOf("://") + 3 : 0;
    const index = normalized.lastIndexOf("/");
    if (index < schemeEnd) return normalized.slice(0, schemeEnd) || ".";
    if (index === 0) return "/";
    return normalized.slice(0, index);
  },
  normalize: normalizePortable,
  relative(from, to) {
    const fromInfo = splitPortableRoot(normalizePortable(from));
    const toInfo = splitPortableRoot(normalizePortable(to));
    if (fromInfo.root !== toInfo.root) return normalizePortable(to);
    const a = fromInfo.parts;
    const b = toInfo.parts;
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    return [...Array(a.length - i).fill(".."), ...b.slice(i)].join("/") || ".";
  },
  isAbsolute(value) {
    return value.startsWith("/") || /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value) || /^[a-zA-Z]:[\\/]/.test(value);
  },
};

function normalizePortable(value: string): string {
  const normalizedSlashes = value.replace(/\\/g, "/");
  const match = normalizedSlashes.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)(.*)$/s);
  const scheme = match?.[1] ?? "";
  const body = match ? match[2] : normalizedSlashes;
  const leadingSlash = body.startsWith("/");
  const out: string[] = [];
  for (const part of body.split("/")) {
    if (!part || part === ".") continue;
    if (part === ".." && out.length && out.at(-1) !== "..") out.pop();
    else if (part === ".." && !leadingSlash) out.push(part);
    else if (part !== "..") out.push(part);
  }
  const prefix = `${scheme}${leadingSlash ? "/" : ""}`;
  const result = `${prefix}${out.join("/")}`;
  if (result) return result;
  if (scheme) return scheme;
  return leadingSlash ? "/" : ".";
}

function splitPortableRoot(value: string): { root: string; parts: string[] } {
  const match = value.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)(.*)$/s);
  if (match) {
    const scheme = match[1]!;
    const body = match[2]!;
    const leading = body.startsWith("/");
    const parts = body.split("/").filter(Boolean);
    // file:/// has no authority; network schemes normally use the first segment as authority.
    if (scheme.toLowerCase() === "file://" || leading) return { root: `${scheme}/`, parts };
    const authority = parts.shift() ?? "";
    return { root: `${scheme}${authority}`, parts };
  }
  if (/^[a-zA-Z]:\//.test(value)) return { root: value.slice(0, 2).toLowerCase(), parts: value.slice(3).split("/").filter(Boolean) };
  return { root: value.startsWith("/") ? "/" : "", parts: value.split("/").filter(Boolean) };
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function sha256Fallback(input: Uint8Array): string {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const bitLength = input.length * 8;
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(input);
  bytes[input.length] = 0x80;
  const view = new DataView(bytes.buffer);
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  view.setUint32(paddedLength - 8, high, false);
  view.setUint32(paddedLength - 4, low, false);
  const w = new Uint32Array(64);
  const rotr = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e!, 6) ^ rotr(e!, 11) ^ rotr(e!, 25);
      const ch = (e! & f!) ^ (~e! & g!);
      const t1 = (h! + s1 + ch + constants[i]! + w[i]!) >>> 0;
      const s0 = rotr(a!, 2) ^ rotr(a!, 13) ^ rotr(a!, 22);
      const maj = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const t2 = (s0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d! + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    hash[0] = (hash[0]! + a!) >>> 0;
    hash[1] = (hash[1]! + b!) >>> 0;
    hash[2] = (hash[2]! + c!) >>> 0;
    hash[3] = (hash[3]! + d!) >>> 0;
    hash[4] = (hash[4]! + e!) >>> 0;
    hash[5] = (hash[5]! + f!) >>> 0;
    hash[6] = (hash[6]! + g!) >>> 0;
    hash[7] = (hash[7]! + h!) >>> 0;
  }
  return hash.map((value) => value.toString(16).padStart(8, "0")).join("");
}

export { createExpoPlatform, type ExpoFileSystemLike, type ExpoSecureStoreLike } from "./expo.js";
