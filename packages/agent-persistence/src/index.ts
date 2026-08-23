/**
 * agent-persistence — durable local state behind small interfaces.
 *
 * SQLite (expo-sqlite) remains the Android source of truth; this package
 * provides the storage contracts plus a JSON-file adapter used by Node tooling
 * and tests. Restart persistence must be lossless.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import type { MemoryRecord, MemoryScope } from "@agentmoataz/agent-protocol";
import type { MemoryStore } from "@agentmoataz/agent-memory";

export interface KeyValueStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
}

/** Atomic JSON-file store: writes go to temp file then rename. */
export class JsonFileStore implements KeyValueStore {
  private cache = new Map<string, unknown>();
  private loaded = false;

  constructor(private filePath: string) {}

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fsp.readFile(this.filePath, "utf8");
      const obj = JSON.parse(raw) as Record<string, unknown>;
      for (const [k, v] of Object.entries(obj)) this.cache.set(k, v);
    } catch {
      // first run / missing file
    }
    this.loaded = true;
  }

  private async flush(): Promise<void> {
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
    const obj: Record<string, unknown> = {};
    for (const [k, v] of this.cache) obj[k] = v;
    const tmp = `${this.filePath}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(obj), "utf8");
    await fsp.rename(tmp, this.filePath);
  }

  async get<T>(key: string): Promise<T | null> {
    await this.load();
    return (this.cache.get(key) as T) ?? null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.load();
    this.cache.set(key, value);
    await this.flush();
  }

  async delete(key: string): Promise<void> {
    await this.load();
    this.cache.delete(key);
    await this.flush();
  }

  async keys(prefix = ""): Promise<string[]> {
    await this.load();
    return [...this.cache.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
}

/** Typed collection over a KeyValueStore with auto ids. */
export class Collection<T extends { id: string }> {
  constructor(private store: KeyValueStore, private name: string) {}

  private key(id: string): string {
    return `${this.name}:${id}`;
  }

  async put(doc: T): Promise<void> {
    await this.store.set(this.key(doc.id), doc);
  }

  async get(id: string): Promise<T | null> {
    return this.store.get<T>(this.key(id));
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(this.key(id));
  }

  async all(): Promise<T[]> {
    const keys = await this.store.keys(`${this.name}:`);
    const out: T[] = [];
    for (const k of keys) {
      const doc = await this.store.get<T>(k);
      if (doc) out.push(doc);
    }
    return out;
  }
}

/** SQLite-backed-equivalent memory adapter persisting across restarts. */
export class PersistentMemoryStore implements MemoryStore {
  private coll: Collection<MemoryRecord>;

  constructor(store: KeyValueStore) {
    this.coll = new Collection<MemoryRecord>(store, "memories");
  }

  async all(): Promise<MemoryRecord[]> {
    return this.coll.all();
  }

  async put(record: MemoryRecord): Promise<void> {
    await this.coll.put(record);
  }

  async delete(id: string): Promise<void> {
    await this.coll.delete(id);
  }
}

export function scopeMatches(record: MemoryRecord, scopes?: MemoryScope[]): boolean {
  return !scopes || scopes.includes(record.scope);
}
