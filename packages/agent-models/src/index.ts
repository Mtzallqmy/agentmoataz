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
    this.fallback = options?.fallback ?? "MOCK: I reviewed the request. Proceed with the current plan step and use available tools.";
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

  get calls(): number { return this.callCount; }

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
    const content = entry ? entry.reply : `${this.fallback}\n[echo of goal]: ${lastUser?.content.slice(0, 200) ?? ""}`;
    return { content, finishReason: "stop" };
  }
}

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
    if (!config.modelId?.trim()) {
      throw new AgentError({
        code: "MODEL_UNAVAILABLE",
        category: "model",
        message: `provider ${config.id} requires modelId`,
        recoverable: true,
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
    if (this.config.secretRef && !key) {
      throw new AgentError({
        code: "SECRET_UNAVAILABLE",
        category: "secret",
        message: `credential ${this.config.secretRef} is unavailable`,
        recoverable: true,
        retryable: false,
      });
    }

    const body: Record<string, unknown> = {
      model: this.config.modelId,
      messages: req.messages.map(toOpenAIMessage),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
      ...(req.tools?.length
        ? {
            tools: req.tools.map((tool) => ({
              type: "function",
              function: { name: tool.name, description: tool.description, parameters: tool.parameters },
            })),
          }
        : {}),
    };

    let res: Response;
    try {
      res = await fetch(providerEndpoint(this.config.baseUrl!, "chat/completions"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) {
        throw new AgentError({ code: "TOOL_CANCELLED", category: "tool", message: "model request cancelled", recoverable: true, retryable: false });
      }
      throw new AgentError({
        code: "NETWORK_UNAVAILABLE",
        category: "network",
        message: `request to ${this.config.displayName} failed`,
        recoverable: true,
        retryable: true,
        technicalCause: error instanceof Error ? error.message : String(error),
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

    const responseJson = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
        };
        finish_reason?: string;
      }>;
    };
    const choice = responseJson.choices?.[0];
    const message = choice?.message;
    const rawCalls = message?.tool_calls ?? [];
    const toolCalls = rawCalls
      .filter((call) => call.function?.name)
      .map((call, index) => ({
        id: call.id ?? `call_${index}`,
        name: call.function!.name!,
        argumentsJson: call.function?.arguments ?? "{}",
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

function providerEndpoint(baseUrl: string, relativePath: string): URL {
  const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(relativePath.replace(/^\/+/, ""), normalized);
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

export interface RoutePreference {
  requiredCapability: ProviderCapability;
  preferLocal?: boolean;
}

export class ProviderRouter {
  constructor(private providers: ModelProvider[]) {}

  route(pref: RoutePreference): ModelProvider {
    const candidates = this.providers.filter((provider) => provider.config.enabled && provider.supports(pref.requiredCapability));
    if (candidates.length === 0) {
      throw new AgentError({
        code: "CAPABILITY_UNAVAILABLE",
        category: "capability",
        message: `no enabled provider supports "${pref.requiredCapability}"`,
        recoverable: false,
        retryable: false,
      });
    }
    return candidates.sort((a, b) => b.config.priority - a.config.priority)[0]!;
  }

  async chatWithFallback(pref: RoutePreference, req: ChatRequest): Promise<ChatResponse> {
    const candidates = this.providers
      .filter((provider) => provider.config.enabled && provider.supports(pref.requiredCapability))
      .sort((a, b) => b.config.priority - a.config.priority);
    let lastError: unknown;
    for (const provider of candidates) {
      try {
        return await provider.chat(req);
      } catch (error) {
        lastError = error;
        const retryable = error instanceof AgentError && error.retryable;
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
    return messages.map((message) => `[${message.role}] ${message.content}`).join("\n");
  }
}
