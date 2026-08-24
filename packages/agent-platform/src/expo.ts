import { portablePath, type CryptoAdapter, type FileSystemAdapter, type PlatformAdapters, type SecureSecretAdapter } from "./index.js";

export interface ExpoFileSystemLike {
  documentDirectory: string | null;
  cacheDirectory: string | null;
  readAsStringAsync(path: string, options?: { encoding?: string }): Promise<string>;
  writeAsStringAsync(path: string, content: string, options?: { encoding?: string }): Promise<void>;
  makeDirectoryAsync(path: string, options?: { intermediates?: boolean }): Promise<void>;
  deleteAsync(path: string, options?: { idempotent?: boolean }): Promise<void>;
  moveAsync(options: { from: string; to: string }): Promise<void>;
  copyAsync(options: { from: string; to: string }): Promise<void>;
  readDirectoryAsync(path: string): Promise<string[]>;
  getInfoAsync(path: string): Promise<{ exists: boolean; isDirectory?: boolean; size?: number; modificationTime?: number }>;
}

export interface ExpoSecureStoreLike {
  setItemAsync(key: string, value: string): Promise<void>;
  getItemAsync(key: string): Promise<string | null>;
  deleteItemAsync(key: string): Promise<void>;
}

export function createExpoPlatform(expoFs: ExpoFileSystemLike, secureStore: ExpoSecureStoreLike, crypto: CryptoAdapter): PlatformAdapters {
  const fs: FileSystemAdapter = {
    readText: (path) => expoFs.readAsStringAsync(path),
    async readBytes(path) { const encoded = await expoFs.readAsStringAsync(path, { encoding: "base64" }); return base64ToBytes(encoded); },
    async writeText(path, content) { await ensureParent(path, expoFs); await expoFs.writeAsStringAsync(path, content); },
    async writeBytes(path, content) { await ensureParent(path, expoFs); await expoFs.writeAsStringAsync(path, bytesToBase64(content), { encoding: "base64" }); },
    async mkdir(path) { await expoFs.makeDirectoryAsync(path, { intermediates: true }); },
    async remove(path) { await expoFs.deleteAsync(path, { idempotent: true }); },
    async rename(from, to) { await ensureParent(to, expoFs); await expoFs.moveAsync({ from, to }); },
    async copy(from, to) { await ensureParent(to, expoFs); await expoFs.copyAsync({ from, to }); },
    async list(path) {
      const names = await expoFs.readDirectoryAsync(path);
      return Promise.all(names.map(async (name) => {
        const child = portablePath.join(path, name);
        const info = await expoFs.getInfoAsync(child);
        return { name, path: child, isDirectory: Boolean(info.isDirectory), sizeBytes: info.size ?? 0 };
      }));
    },
    async stat(path) { const info = await expoFs.getInfoAsync(path); if (!info.exists) throw new Error(`missing path: ${path}`); return { isDirectory: Boolean(info.isDirectory), sizeBytes: info.size ?? 0, modifiedAtMs: (info.modificationTime ?? 0) * 1000 }; },
    async exists(path) { return (await expoFs.getInfoAsync(path)).exists; },
  };

  const secrets: SecureSecretAdapter = {
    storeSecret: (ref, value) => secureStore.setItemAsync(ref, value),
    resolveSecret: (ref) => secureStore.getItemAsync(ref),
    deleteSecret: (ref) => secureStore.deleteItemAsync(ref),
  };

  return {
    fs,
    path: portablePath,
    crypto,
    secrets,
    runtime: {
      now: () => Date.now(),
      platform: "android",
      tempDirectory: expoFs.cacheDirectory ?? "",
      appDataDirectory: expoFs.documentDirectory ?? "",
    },
  };
}

async function ensureParent(path: string, fs: ExpoFileSystemLike): Promise<void> {
  const parent = portablePath.dirname(path);
  if (parent !== ".") await fs.makeDirectoryAsync(parent, { intermediates: true });
}

function base64ToBytes(value: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = value.replace(/=+$/, "");
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    buffer = (buffer << 6) | alphabet.indexOf(char);
    bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buffer >> bits) & 0xff); }
  }
  return new Uint8Array(out);
}

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += alphabet[(n >> 18) & 63]! + alphabet[(n >> 12) & 63]! + (i + 1 < bytes.length ? alphabet[(n >> 6) & 63]! : "=") + (i + 2 < bytes.length ? alphabet[n & 63]! : "=");
  }
  return out;
}
