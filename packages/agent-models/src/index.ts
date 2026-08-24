/**
 * Model provider abstraction + deterministic MockProvider +
 * OpenAI-compatible HTTP adapter + capability-based ProviderRouter.
 */
import type {
  ChatRequest,
  ChatResponse,
  ChatMessage,
  ProviderCapability,
  ProviderConfig,
} from "@agentmoataz/agent-protocol";
import { AgentError } from "@agentmoataz/agent-protocol";

export interface ModelProvider {
  readonly config: ProviderConfig;
  supports(capability: ProviderCapability): boolean;
  chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse>;
}

/* ------------------------------------------------------------------ */
/* MockProvider — deterministic, no network. Used in tests & offline.  */
/* ------------------------------------------------------------------ */

export interface MockScriptEntry {
  /** Substring matched against the last user message to select this reply. */
  match: string;
  reply: string;
  /** Optional scripted tool calls returned with this reply. */
  toolCalls?: Array<{ id?: string; name: string; arguments: unknown }>;
}

export class MockProvider implements ModelProvider {
  readonly config: ProviderConfig;
  private callCount = 0;
  private replies: MockScriptEntry[];
  private fallback: string;
  private seq = 0;

  constructor(options?: {
    replies?: MockScriptEntry[];
    fallback?: string;
    id?: string;
    displayName?: string;
    priority?: number;
  }) {
    this.replies = options?.replies ?? [];
    this.fallback =
      options?.fallback ??
      "MOCK: I reviewed the request. Proceed with the current plan step and use available tools.";
    this.config = {
      id: options?.id ?? "mock",
      kind: "mock",
      displayName: options?.displayName ?? "Mock (deterministic)",
      baseUrl: null,
      modelId: "mock-1",
      capabilities: ["chat", "coding", "tool_calling", "structured_output"],
      secretRef: null,
      enabled: true,
      priority: options?.priority ?? 0,
    };
  }

  get calls(): number {
    return this.callCount;
  }

  supports(capability: ProviderCapability): boolean {
    return this.config.capabilities.includes(capability);
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.callCount++;
    const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
    const entry = this.replies.find((r) => lastUser && lastUser.content.includes(r.match));
    if (entry?.toolCalls?.length) {
      return {
        content: entry.reply,
        finishReason: "stop",
        toolCalls: entry.toolCalls.map((c, i) => ({
          id: c.id ?? `mock_call_${++this.seq}_${i}`,
          name: c.name,
          argumentsJson: JSON.stringify(c.arguments),
        })),
      };
    }
    // Deterministic output derived from input when no script matches.
    const content = entry
      ? entry.reply
      : `${this.fallback}\n[echo of goal]: ${lastUser?.content.slice(0, 200) ?? ""}`;
    return { content, finishReason: "stop" };
  }
}

/* ------------------------------------------------------------------ */
/* OpenAI-compatible adapter (OpenAI, OpenRouter, Groq, LM Studio...)   */
/* ------------------------------------------------------------------ */

export interface SecretResolver {
  /** Resolve a secretRef to the actual credential, or null. */
  resolve(ref: string): Promise<string | null>;
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly config: ProviderConfig;
  private secrets: SecretResolver;

  constructor(config: ProviderConfig, secrets: SecretResolver) {
    if (!config.baseUrl) {
      throw new AgentError({
        code: "MODEL_UNAVAILABLE",
        category: "model",
        message: `provider ${config.id} requires baseUrl`,
        recoverable: false,
        retryable: false,
      });
    }
    this.config = config;
    this.secrets = secrets;
  }

  supports(capability: ProviderCapability): boolean {
    return this.config.capabilities.includes(capability);
  }

  async chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
    const key = this.config.secretRef ? await this.secrets.resolve(this.config.secretRef) : null;

    const body: Record<string, unknown> = {
      model: this.config.modelId,
      messages: req.messages.map(toOpenAIMessage),
      temperature: req.temperature,
      max_tokens: req.maxTokens,
      ...(req.tools?.length
        ? {
            tools: req.tools.map((t) => ({
              type: "function",
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
          }
        : {}),
    };

    let res: Response;
    try {
      res = await fetch(new URL("chat/completions", this.config.baseUrl!), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      throw new AgentError({
        code: "NETWORK_UNAVAILABLE",
        category: "network",
        message: `request to ${this.config.displayName} failed`,
        recoverable: true,
        retryable: true,
        technicalCause: e instanceof Error ? e.message : String(e),
      });
    }

    if (res.status === 429) {
      throw new AgentError({
        code: "MODEL_RATE_LIMITED",
        category: "model",
        message: `${this.config.displayName} rate limited`,
        recoverable: true,
        retryable: true,
      });
    }
    if (!res.ok) {
      throw new AgentError({
        code: "MODEL_UNAVAILABLE",
        category: "model",
        message: `${this.config.displayName} returned ${res.status}`,
        recoverable: true,
        retryable: res.status >= 500,
        technicalCause: await res.text().catch(() => ""),
      });
    }

    const bodyJson = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
        finish_reason?: string;
      }>;
    };
    const choice = bodyJson.choices?.[0];
    const message = choice?.message;
    const rawCalls = message?.tool_calls ?? [];
    const toolCalls = rawCalls
      .filter((c) => c.function?.name)
      .map((c, i) => ({
        id: c.id ?? `call_${i}`,
        name: c.function!.name!,
        argumentsJson: c.function?.arguments ?? "{}",
      }));

    return {
      content: message?.content ?? "",
      finishReason:
        toolCalls.length > 0
          ? "stop"
          : choice?.finish_reason === "length"
            ? "length"
            : choice?.finish_reason === "stop"
              ? "stop"
              : "error",
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
  }
}

function toOpenAIMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.argumentsJson },
      })),
    };
  }
  if (message.role === "tool") {
    return {
      role: "tool",
      content: message.content,
      tool_call_id: message.toolCallId,
      ...(message.name ? { name: message.name } : {}),
    };
  }
  return { role: message.role, content: message.content, ...(message.name ? { name: message.name } : {}) };
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

export interface RoutePreference {
  requiredCapability: ProviderCapability;
  preferLocal?: boolean;
}

export class ProviderRouter {
  constructor(private providers: ModelProvider[]) {}

  route(pref: RoutePreference): ModelProvider {
    const candidates = this.providers.filter(
      (p) => p.config.enabled && p.supports(pref.requiredCapability)
    );
    if (candidates.length === 0) {
      throw new AgentError({
        code: "CAPABILITY_UNAVAILABLE",
        category: "capability",
        message: `no enabled provider supports "${pref.requiredCapability}"`,
        recoverable: false,
        retryable: false,
      });
    }
    const sorted = candidates.sort((a, b) => b.config.priority - a.config.priority);
    return sorted[0]!;
  }

  async chatWithFallback(pref: RoutePreference, req: ChatRequest): Promise<ChatResponse> {
    const candidates = this.providers
      .filter((p) => p.config.enabled && p.supports(pref.requiredCapability))
      .sort((a, b) => b.config.priority - a.config.priority);
    let lastError: unknown;
    for (const p of candidates) {
      try {
        return await p.chat(req);
      } catch (e) {
        lastError = e;
        const retryable = e instanceof AgentError && e.retryable;
        if (!retryable) break;
      }
    }
    throw lastError ?? new AgentError({
      code: "MODEL_UNAVAILABLE",
      category: "model",
      message: "all providers failed",
      recoverable: false,
      retryable: false,
    });
  }

  messagesToPrompt(messages: ChatMessage[]): string {
    return messages.map((m) => `[${m.role}] ${m.content}`).join("\n");
  }
}
