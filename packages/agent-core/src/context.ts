/**
 * ContextManager — prevents dumping whole project/history into the prompt.
 * Retrieves only: relevant files, relevant messages, task context, relevant memory,
 * project instructions, tool schemas. Controls context budget & relevance.
 */
import type { Workspace } from "@agentmoataz/agent-workspace";

export interface ContextBudget {
  maxTokens: number;
  maxFiles: number;
  maxMessages: number;
}

const DEFAULT_BUDGET: ContextBudget = { maxTokens: 8000, maxFiles: 8, maxMessages: 12 };

function estimateTokens(text: string): number {
  // heuristic: ~4 chars per token
  return Math.ceil(text.length / 4);
}

export interface RelevantChunk {
  source: "file" | "message" | "memory" | "instruction" | "tool";
  id: string;
  content: string;
  relevance: number;
}

export class ContextManager {
  constructor(private budget: ContextBudget = DEFAULT_BUDGET) {}

  async assemble(params: {
    goal: string;
    workspace?: Workspace;
    recentMessages?: Array<{ role: string; content: string }>;
    memories?: Array<{ content: string; relevance?: number }>;
    instructions?: string;
    toolSchemas?: Array<{ name: string; description: string }>;
    taskContext?: string;
  }): Promise<{ prompt: string; chunks: RelevantChunk[]; tokensUsed: number }> {
    const keywords = params.goal.toLowerCase().split(/\W+/).filter(Boolean);
    const score = (text: string): number => {
      const lower = text.toLowerCase();
      let s = 0;
      for (const kw of keywords) if (lower.includes(kw)) s += 1;
      // boost if file looks like relevant extension for coding tasks
      if (/\.(ts|tsx|js|json|md)$/.test(lower)) s += 0.2;
      return s;
    };

    const chunks: RelevantChunk[] = [];

    if (params.taskContext) chunks.push({ source: "instruction", id: "task", content: params.taskContext.slice(0, 1500), relevance: 10 });
    if (params.instructions) chunks.push({ source: "instruction", id: "project-instructions", content: params.instructions.slice(0, 1500), relevance: 9 });

    if (params.toolSchemas?.length) {
      const schemaText = params.toolSchemas.map((t) => `${t.name}: ${t.description}`).join("\n");
      chunks.push({ source: "tool", id: "tool-schemas", content: schemaText.slice(0, 2000), relevance: 8 });
    }

    for (const m of params.memories ?? []) {
      chunks.push({ source: "memory", id: `mem-${chunks.length}`, content: m.content.slice(0, 800), relevance: score(m.content) + (m.relevance ?? 0) });
    }

    if (params.workspace) {
      try {
        const files = await params.workspace.listTree("", 3);
        const relevantFiles = files.filter((f) => !f.isDirectory).sort((a, b) => score(a.relativePath) - score(b.relativePath)).reverse().slice(0, this.budget.maxFiles * 2);
        for (const f of relevantFiles.slice(0, this.budget.maxFiles)) {
          try {
            const content = await params.workspace.readFile(f.relativePath);
            const rel = score(`${f.relativePath}\n${content.slice(0, 500)}`);
            if (rel > 0 || chunks.length < 3) chunks.push({ source: "file", id: f.relativePath, content: `File ${f.relativePath}:\n${content.slice(0, 1200)}`, relevance: rel });
          } catch { /* skip unreadable */ }
        }
      } catch { /* workspace unavailable */ }
    }

    for (const msg of (params.recentMessages ?? []).slice(-this.budget.maxMessages)) {
      chunks.push({ source: "message", id: `msg-${chunks.length}`, content: `${msg.role}: ${msg.content.slice(0, 800)}`, relevance: score(msg.content) });
    }

    // Sort by relevance and apply token budget
    chunks.sort((a, b) => b.relevance - a.relevance);
    let tokens = 0;
    const selected: RelevantChunk[] = [];
    for (const ch of chunks) {
      const t = estimateTokens(ch.content);
      if (tokens + t > this.budget.maxTokens) break;
      selected.push(ch);
      tokens += t;
    }

    const prompt = selected.map((c) => `[${c.source}:${c.id}] ${c.content}`).join("\n\n");
    return { prompt, chunks: selected, tokensUsed: tokens };
  }

  getBudget(): ContextBudget { return { ...this.budget }; }
}
