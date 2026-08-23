import { describe, it, expect } from "vitest";
import {
  MockProvider,
  OpenAICompatibleProvider,
  ProviderRouter,
} from "../src/index.js";
import { AgentError } from "@agentmoataz/agent-protocol";

describe("MockProvider", () => {
  it("is deterministic and scriptable", async () => {
    const mock = new MockProvider({
      replies: [{ match: "todo", reply: "PLAN: 1) scaffold 2) write files 3) verify" }],
    });
    const res = await mock.chat({
      messages: [{ role: "user", content: "create a todo app" }],
    });
    expect(res.content).toContain("PLAN:");
    expect(res.finishReason).toBe("stop");
    expect(mock.calls).toBe(1);
  });

  it("falls back deterministically without a matching script", async () => {
    const mock = new MockProvider();
    const req = { messages: [{ role: "user" as const, content: "anything" }] };
    expect((await mock.chat(req)).content).toBe((await mock.chat(req)).content);
  });

  it("supports core capabilities", () => {
    const mock = new MockProvider();
    for (const c of ["chat", "coding", "tool_calling"] as const) {
      expect(mock.supports(c)).toBe(true);
    }
    expect(mock.supports("image_generation")).toBe(false);
  });
});

describe("ProviderRouter", () => {
  it("routes by capability and priority", () => {
    const weak = new MockProvider({ priority: 0 });
    const strong = new MockProvider({ id: "cloud-strong", displayName: "Cloud Strong", priority: 100 });
    const router = new ProviderRouter([weak, strong]);
    expect(router.route({ requiredCapability: "chat" }).config.id).toBe("cloud-strong");
  });

  it("throws CAPABILITY_UNAVAILABLE when nothing matches", () => {
    const router = new ProviderRouter([new MockProvider()]);
    try {
      router.route({ requiredCapability: "video_generation" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AgentError);
      expect((e as AgentError).code).toBe("CAPABILITY_UNAVAILABLE");
    }
  });
});

describe("OpenAICompatibleProvider", () => {
  it("requires baseUrl at construction", () => {
    expect(
      () =>
        new OpenAICompatibleProvider(
          {
            id: "x",
            kind: "openai_compatible",
            displayName: "X",
            baseUrl: null,
            modelId: null,
            capabilities: ["chat"],
            secretRef: null,
            enabled: true,
            priority: 10,
          },
          { resolve: async () => null }
        )
    ).toThrow(AgentError);
  });
});
