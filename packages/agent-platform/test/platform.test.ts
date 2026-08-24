import { describe, it, expect } from "vitest";
import { portableCrypto, portablePath, utf8Decode, utf8Encode } from "../src/index.js";
import { nodePlatform } from "../src/node.js";

describe("agent-platform", () => {
  it("portable paths normalize without Node", () => {
    expect(portablePath.join("/a", "b", "../c")).toBe("/a/c");
    expect(portablePath.basename("/a/b.txt")).toBe("b.txt");
    expect(portablePath.dirname("/a/b.txt")).toBe("/a");
  });

  it("preserves Expo file:/// URIs while joining and normalizing", () => {
    const root = "file:///data/user/0/dev.agentmoataz.app/files/";
    expect(portablePath.normalize(root)).toBe("file:///data/user/0/dev.agentmoataz.app/files");
    const workspace = portablePath.join(root, "projects", "p1", "workspace");
    expect(workspace).toBe("file:///data/user/0/dev.agentmoataz.app/files/projects/p1/workspace");
    expect(portablePath.dirname(workspace)).toBe("file:///data/user/0/dev.agentmoataz.app/files/projects/p1");
    expect(portablePath.basename(workspace)).toBe("workspace");
    expect(portablePath.relative(root, workspace)).toBe("projects/p1/workspace");
  });

  it("preserves network URL authorities", () => {
    expect(portablePath.normalize("https://example.com/a/../b")).toBe("https://example.com/b");
  });

  it("portable UTF-8 helpers round-trip Unicode without Web TextEncoder", () => {
    const text = "Agent معتز 🚀";
    expect(utf8Decode(utf8Encode(text))).toBe(text);
  });

  it("portable crypto produces SHA-256 without relying on Node", async () => {
    expect(await portableCrypto.sha256Text("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(portableCrypto.randomId("run")).toMatch(/^run-/);
  });

  it("Node crypto produces SHA-256 and ids", async () => {
    expect(await nodePlatform.crypto.sha256Text("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(nodePlatform.crypto.randomId("run")).toMatch(/^run-/);
  });
});
