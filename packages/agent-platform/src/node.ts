import fs from "node:fs/promises";
import nodePath from "node:path";
import nodeCrypto from "node:crypto";
import os from "node:os";
import type { CryptoAdapter, FileSystemAdapter, PathAdapter, PlatformAdapters, RuntimeAdapter } from "./index.js";

export const nodeFileSystem: FileSystemAdapter = {
  readText: (path) => fs.readFile(path, "utf8"),
  async readBytes(path) { return new Uint8Array(await fs.readFile(path)); },
  async writeText(path, content) { await fs.mkdir(nodePath.dirname(path), { recursive: true }); await fs.writeFile(path, content, "utf8"); },
  async writeBytes(path, content) { await fs.mkdir(nodePath.dirname(path), { recursive: true }); await fs.writeFile(path, content); },
  async mkdir(path) { await fs.mkdir(path, { recursive: true }); },
  async remove(path, recursive = false) { await fs.rm(path, { recursive, force: true }); },
  async rename(from, to) { await fs.mkdir(nodePath.dirname(to), { recursive: true }); await fs.rename(from, to); },
  async copy(from, to) { await fs.mkdir(nodePath.dirname(to), { recursive: true }); await fs.copyFile(from, to); },
  async list(path) {
    const entries = await fs.readdir(path, { withFileTypes: true });
    return Promise.all(entries.map(async (entry) => {
      const full = nodePath.join(path, entry.name);
      const stat = await fs.stat(full);
      return { name: entry.name, path: full, isDirectory: entry.isDirectory(), sizeBytes: stat.size };
    }));
  },
  async stat(path) { const stat = await fs.stat(path); return { isDirectory: stat.isDirectory(), sizeBytes: stat.size, modifiedAtMs: stat.mtimeMs }; },
  async exists(path) { try { await fs.access(path); return true; } catch { return false; } },
};

export const nodePathAdapter: PathAdapter = {
  join: (...parts) => nodePath.join(...parts),
  basename: nodePath.basename,
  dirname: nodePath.dirname,
  normalize: nodePath.normalize,
  relative: nodePath.relative,
  isAbsolute: nodePath.isAbsolute,
};

export const nodeCryptoAdapter: CryptoAdapter = {
  randomId(prefix = "id") { return `${prefix}-${Date.now()}-${nodeCrypto.randomBytes(4).toString("hex")}`; },
  async sha256Text(content) { return nodeCrypto.createHash("sha256").update(content).digest("hex"); },
  async sha256Bytes(content) { return nodeCrypto.createHash("sha256").update(content).digest("hex"); },
};

export const nodeRuntimeAdapter: RuntimeAdapter = {
  now: () => Date.now(),
  platform: "node",
  tempDirectory: os.tmpdir(),
  appDataDirectory: nodePath.join(os.homedir(), ".agentmoataz"),
};

export const nodePlatform: PlatformAdapters = {
  fs: nodeFileSystem,
  path: nodePathAdapter,
  crypto: nodeCryptoAdapter,
  runtime: nodeRuntimeAdapter,
};
