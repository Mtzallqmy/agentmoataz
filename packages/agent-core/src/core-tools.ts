/**
 * Built-in core tools: project file operations wired to a Workspace.
 * Each declares its permission category and input schema.
 */
import { z } from "zod";
import { Workspace } from "@agentmoataz/agent-workspace";
import type { Tool, ToolContext } from "./tools.js";

export function buildCoreFileTools(workspace: Workspace): Tool[] {
  const writeSchema = z.object({
    path: z.string().min(1),
    content: z.string(),
  });
  const readSchema = z.object({ path: z.string().min(1) });
  const deleteSchema = z.object({ path: z.string().min(1) });

  const writeFile: Tool<{ path: string; content: string }, { written: true }> = {
    name: "write_file",
    description: "Create or overwrite a file inside the project workspace.",
    permissionCategory: "write_project_file",
    inputSchema: writeSchema,
    async execute(input) {
      await workspace.writeFile(input.path, input.content);
      return { written: true };
    },
  };

  const readFile: Tool<{ path: string }, { content: string }> = {
    name: "read_file",
    description: "Read a text file from the project workspace.",
    permissionCategory: "read_project_file",
    inputSchema: readSchema,
    async execute(input) {
      return { content: await workspace.readFile(input.path) };
    },
  };

  const listTree: Tool<Record<string, never>, { entries: Array<{ relativePath: string; isDirectory: boolean }> }> = {
    name: "list_tree",
    description: "List the project workspace tree.",
    permissionCategory: "read_project_file",
    inputSchema: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
    async execute() {
      const entries = (await workspace.listTree()).map((e) => ({
        relativePath: e.relativePath,
        isDirectory: e.isDirectory,
      }));
      return { entries };
    },
  };

  const deleteFile: Tool<{ path: string }, { deleted: true }> = {
    name: "delete_file",
    description: "Delete a file inside the project workspace (requires approval by default).",
    permissionCategory: "delete_file",
    inputSchema: deleteSchema,
    async execute(input, _ctx: ToolContext) {
      await workspace.deleteFile(input.path);
      return { deleted: true };
    },
  };

  const searchText: Tool<{ pattern: string; subdir?: string }, { hits: number; results: Array<{ relativePath: string; line: number }> }> = {
    name: "search_text",
    description: "Search for literal text across workspace files.",
    permissionCategory: "read_project_file",
    inputSchema: z.object({ pattern: z.string().min(1), subdir: z.string().optional() }),
    async execute(input) {
      const results = await workspace.searchText(input.pattern, input.subdir ?? "");
      return {
        hits: results.length,
        results: results.map((r) => ({ relativePath: r.relativePath, line: r.line })),
      };
    },
  };

  return [writeFile, readFile, listTree, deleteFile, searchText];
}
