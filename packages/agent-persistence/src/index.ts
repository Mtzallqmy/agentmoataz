/**
 * agent-persistence — durable local state behind small interfaces.
 *
 * SQLite (expo-sqlite) remains the Android source of truth; this package
 * provides the storage contracts plus a JSON-file adapter used by Node tooling
 * and tests. Restart persistence must be lossless.
 */
import type { MemoryRecord, MemoryScope } from "@agentmoataz/agent-protocol";
import type { MemoryStore } from "@agentmoataz/agent-memory";

export interface KeyValueStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
}

export class InMemoryKeyValueStore implements KeyValueStore {
  private values = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | null> { return (this.values.get(key) as T) ?? null; }
  async set<T>(key: string, value: T): Promise<void> { this.values.set(key, value); }
  async delete(key: string): Promise<void> { this.values.delete(key); }
  async keys(prefix = ""): Promise<string[]> { return [...this.values.keys()].filter((key) => key.startsWith(prefix)).sort(); }
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

/* ------------------------------------------------------------------ */
/* RuntimeStore adapter — durable agent runs + events over KeyValue    */
/* ------------------------------------------------------------------ */

import type { AgentEvent, AgentRun } from "@agentmoataz/agent-protocol";

export class JsonRuntimeStore {
  private runs: Collection<AgentRun>;
  private events: Collection<AgentEvent & { k: string }>;

  constructor(store: KeyValueStore) {
    this.runs = new Collection<AgentRun>(store, "runs");
    this.events = new Collection<AgentEvent & { k: string }>(store, "events");
  }

  async saveRun(run: AgentRun): Promise<void> {
    await this.runs.put(run);
  }

  async getRun(id: string): Promise<AgentRun | null> {
    return this.runs.get(id);
  }

  async listRuns(): Promise<AgentRun[]> {
    const all = await this.runs.all();
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async appendEvent(event: AgentEvent): Promise<void> {
    await this.events.put({ ...event, k: `${event.runId}:${event.id}` });
  }

  async listEvents(runId: string): Promise<AgentEvent[]> {
    const all = await this.events.all();
    return all
      .filter((e) => e.runId === runId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(({ k: _k, ...rest }) => rest as AgentEvent);
  }
}

export {
  SQLITE_SCHEMA_VERSION,
  SqliteKeyValueStore,
  SqliteRuntimeStore,
  migrateRuntimeDatabase,
  type ExpoSqliteDatabase,
} from "./expo-sqlite.js";
