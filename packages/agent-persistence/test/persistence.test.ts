import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import {
  Collection,
  PersistentMemoryStore,
} from "../src/index.js";
import { JsonFileStore } from "../src/node.js";
import { MemoryManager } from "@agentmoataz/agent-memory";

let dir: string;
beforeAll(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "persist-"));
});
afterAll(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
});

interface Doc {
  id: string;
  name: string;
}

describe("JsonFileStore", () => {
  it("persists data across a simulated app restart", async () => {
    const file = path.join(dir, "state.json");
    const store1 = new JsonFileStore(file);
    await store1.set("run:1", { state: "completed" });
    await store1.set("run:2", { state: "failed" });

    // "restart": new instance over the same file
    const store2 = new JsonFileStore(file);
    expect(await store2.get<{ state: string }>("run:1")).toEqual({ state: "completed" });
    expect((await store2.keys("run:")).sort()).toEqual(["run:1", "run:2"]);
  });

  it("writes are atomic (no partial tmp leftovers)", async () => {
    const file = path.join(dir, "atomic.json");
    const store = new JsonFileStore(file);
    await store.set("k", { v: 42 });
    const files = await fsp.readdir(dir);
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
  });

  it("Collection CRUD over the store", async () => {
    const store = new JsonFileStore(path.join(dir, "coll.json"));
    const docs = new Collection<Doc>(store, "projects");
    await docs.put({ id: "p1", name: "todo-app" });
    await docs.put({ id: "p2", name: "game" });
    expect((await docs.get("p1"))?.name).toBe("todo-app");
    await docs.delete("p1");
    expect(await docs.get("p1")).toBeNull();
    expect((await docs.all()).map((d) => d.id)).toEqual(["p2"]);
  });

  it("PersistentMemoryStore survives restart and integrates with MemoryManager", async () => {
    const file = path.join(dir, "mem.json");
    const mgr1 = new MemoryManager(new PersistentMemoryStore(new JsonFileStore(file)));
    await mgr1.remember({ scope: "project", scopeKey: "p9", content: "uses vitest for tests" });

    const mgr2 = new MemoryManager(new PersistentMemoryStore(new JsonFileStore(file)));
    const hits = await mgr2.retrieve("vitest");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.content).toContain("vitest");
  });
});
