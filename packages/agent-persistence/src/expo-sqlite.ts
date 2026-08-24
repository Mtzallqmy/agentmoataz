import type { AgentEvent, AgentRun } from "@agentmoataz/agent-protocol";
import type { KeyValueStore } from "./index.js";

export const SQLITE_SCHEMA_VERSION = 1;

export interface ExpoSqliteDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: unknown[]): Promise<{ changes: number; lastInsertRowId: number }>;
  getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

const TABLES = [
  "projects", "sessions", "messages", "agent_runs", "tasks", "task_steps",
  "tool_calls", "approvals", "artifacts", "checkpoints", "memories", "skills",
  "provider_configs", "settings", "audit_logs", "runtime_events",
] as const;

export async function migrateRuntimeDatabase(db: ExpoSqliteDatabase): Promise<void> {
  await db.execAsync("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  await db.withTransactionAsync(async () => {
    await db.execAsync("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);");
    for (const table of TABLES) {
      const primary = table === "runtime_events" ? "id TEXT PRIMARY KEY, run_id TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL" : "id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL";
      await db.execAsync(`CREATE TABLE IF NOT EXISTS ${table} (${primary});`);
    }
    await db.execAsync("CREATE INDEX IF NOT EXISTS idx_runtime_events_run ON runtime_events(run_id, created_at);");
    await db.execAsync("DELETE FROM schema_version; INSERT INTO schema_version(version) VALUES (1);");
  });
}

/** Production Android source of truth for runs and runtime events. */
export class SqliteRuntimeStore {
  constructor(private db: ExpoSqliteDatabase) {}

  async initialize(): Promise<void> { await migrateRuntimeDatabase(this.db); }

  async saveRun(run: AgentRun): Promise<void> {
    await this.db.runAsync(
      "INSERT INTO agent_runs(id,payload_json,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json, updated_at=excluded.updated_at",
      run.id, JSON.stringify(run), run.updatedAt
    );
  }

  async getRun(id: string): Promise<AgentRun | null> {
    const row = await this.db.getFirstAsync<{ payload_json: string }>("SELECT payload_json FROM agent_runs WHERE id=?", id);
    return row ? JSON.parse(row.payload_json) as AgentRun : null;
  }

  async listRuns(): Promise<AgentRun[]> {
    const rows = await this.db.getAllAsync<{ payload_json: string }>("SELECT payload_json FROM agent_runs ORDER BY updated_at");
    return rows.map((row) => JSON.parse(row.payload_json) as AgentRun);
  }

  async appendEvent(event: AgentEvent): Promise<void> {
    await this.db.runAsync(
      "INSERT OR REPLACE INTO runtime_events(id,run_id,payload_json,created_at) VALUES(?,?,?,?)",
      event.id, event.runId, JSON.stringify(event), event.createdAt
    );
  }

  async listEvents(runId: string): Promise<AgentEvent[]> {
    const rows = await this.db.getAllAsync<{ payload_json: string }>("SELECT payload_json FROM runtime_events WHERE run_id=? ORDER BY created_at", runId);
    return rows.map((row) => JSON.parse(row.payload_json) as AgentEvent);
  }
}

/** Key/value view over the SQLite settings table for memory and app settings. */
export class SqliteKeyValueStore implements KeyValueStore {
  constructor(private db: ExpoSqliteDatabase) {}

  async get<T>(key: string): Promise<T | null> {
    const row = await this.db.getFirstAsync<{ payload_json: string }>("SELECT payload_json FROM settings WHERE id=?", key);
    return row ? JSON.parse(row.payload_json) as T : null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.db.runAsync(
      "INSERT INTO settings(id,payload_json,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json, updated_at=excluded.updated_at",
      key, JSON.stringify(value), new Date().toISOString()
    );
  }

  async delete(key: string): Promise<void> {
    await this.db.runAsync("DELETE FROM settings WHERE id=?", key);
  }

  async keys(prefix = ""): Promise<string[]> {
    const rows = await this.db.getAllAsync<{ id: string }>("SELECT id FROM settings WHERE id LIKE ? ORDER BY id", `${prefix}%`);
    return rows.map((row) => row.id);
  }
}
