/**
 * MemoryManager — layered memory (working / session / project / long_term).
 *
 * Storage is behind a small interface so the Android app can back it with
 * SQLite while tests and Node tooling use the in-memory adapter.
 */
import type { MemoryRecord, MemoryScope } from "@agentmoataz/agent-protocol";

export interface MemoryStore {
  all(): Promise<MemoryRecord[]>;
  put(record: MemoryRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

export class InMemoryMemoryStore implements MemoryStore {
  private records = new Map<string, MemoryRecord>();
  async all(): Promise<MemoryRecord[]> {
    return [...this.records.values()];
  }
  async put(r: MemoryRecord): Promise<void> {
    this.records.set(r.id, r);
  }
  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }
}

let seq = 0;

export class MemoryManager {
  private store: MemoryStore;

  constructor(store: MemoryStore = new InMemoryMemoryStore()) {
    this.store = store;
  }

  async remember(init: {
    scope: MemoryScope;
    scopeKey?: string;
    content: string;
    source?: string;
    confidence?: number;
  }): Promise<MemoryRecord> {
    const now = new Date().toISOString();
    const record: MemoryRecord = {
      id: `mem-${Date.now()}-${++seq}`,
      scope: init.scope,
      scopeKey: init.scopeKey ?? "",
      content: init.content,
      source: init.source ?? "agent",
      confidence: init.confidence ?? 0.8,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.put(record);
    return record;
  }

  /** Retrieve relevant memory for a query instead of dumping everything. */
  async retrieve(query: string, opts?: { scopes?: MemoryScope[]; scopeKey?: string; limit?: number }): Promise<MemoryRecord[]> {
    const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
    let records = await this.store.all();
    if (opts?.scopes?.length) records = records.filter((r) => opts.scopes!.includes(r.scope));
    if (opts?.scopeKey !== undefined) records = records.filter((r) => r.scopeKey === opts.scopeKey);
    records = records.filter((r) => r.enabled);

    const scored = records.map((r) => {
      const hay = r.content.toLowerCase();
      const score = terms.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0) * r.confidence;
      return { r, score };
    });
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, opts?.limit ?? 10)
      .map((s) => s.r);
  }

  async listAll(): Promise<MemoryRecord[]> {
    return this.store.all();
  }

  async updateContent(id: string, content: string): Promise<MemoryRecord | null> {
    const records = await this.store.all();
    const rec = records.find((r) => r.id === id);
    if (!rec) return null;
    rec.content = content;
    rec.updatedAt = new Date().toISOString();
    await this.store.put(rec);
    return rec;
  }

  async setEnabled(id: string, enabled: boolean): Promise<boolean> {
    const records = await this.store.all();
    const rec = records.find((r) => r.id === id);
    if (!rec) return false;
    rec.enabled = enabled;
    rec.updatedAt = new Date().toISOString();
    await this.store.put(rec);
    return true;
  }

  async forget(id: string): Promise<void> {
    await this.store.delete(id);
  }
}
