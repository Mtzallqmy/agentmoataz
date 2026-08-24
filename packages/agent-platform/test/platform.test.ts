import { describe, it, expect } from "vitest";
import { portablePath } from "../src/index.js";
import { nodePlatform } from "../src/node.js";

describe("agent-platform", () => {
  it("portable paths normalize without Node", () => {
    expect(portablePath.join("/a", "b", "../c")).toBe("/a/c");
    expect(portablePath.basename("/a/b.txt")).toBe("b.txt");
    expect(portablePath.dirname("/a/b.txt")).toBe("/a");
  });

  it("Node crypto produces SHA-256 and ids", async () => {
    expect(await nodePlatform.crypto.sha256Text("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(nodePlatform.crypto.randomId("run")).toMatch(/^run-/);
  });
});
