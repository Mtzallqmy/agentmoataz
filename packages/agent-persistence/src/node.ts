import fsp from "node:fs/promises";
import path from "node:path";
import type { KeyValueStore } from "./index.js";

/** Atomic JSON file adapter for tests/cloud tooling. Not imported by Android. */
export class JsonFileStore implements KeyValueStore {
  private cache = new Map<string, unknown>();
  private loaded = false;

  constructor(private filePath: string) {}

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const object = JSON.parse(await fsp.readFile(this.filePath, "utf8")) as Record<string, unknown>;
      for (const [key, value] of Object.entries(object)) this.cache.set(key, value);
    } catch {
      // First run.
    }
    this.loaded = true;
  }

  private async flush(): Promise<void> {
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
    const object = Object.fromEntries(this.cache);
    const temporary = `${this.filePath}.tmp`;
    await fsp.writeFile(temporary, JSON.stringify(object), "utf8");
    await fsp.rename(temporary, this.filePath);
  }

  async get<T>(key: string): Promise<T | null> { await this.load(); return (this.cache.get(key) as T) ?? null; }
  async set<T>(key: string, value: T): Promise<void> { await this.load(); this.cache.set(key, value); await this.flush(); }
  async delete(key: string): Promise<void> { await this.load(); this.cache.delete(key); await this.flush(); }
  async keys(prefix = ""): Promise<string[]> { await this.load(); return [...this.cache.keys()].filter((key) => key.startsWith(prefix)).sort(); }
}
