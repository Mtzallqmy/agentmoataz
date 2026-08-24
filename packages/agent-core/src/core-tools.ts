/**
 * Built-in project workspace tools.
 *
 * Every operation is rooted by Workspace path security and still passes through
 * PermissionEngine in the runtime. Keep this list portable: no Node-only APIs.
 */
import { z } from "zod";
import { Workspace } from "@agentmoataz/agent-workspace";
import type { Tool, ToolContext } from "./tools.js";

export function buildCoreFileTools(workspace: Workspace): Tool[] {
  const pathSchema = z.string().min(1).max(1024);
  const writeSchema = z.object({ path: pathSchema, content: z.string() });
  const readSchema = z.object({ path: pathSchema });
  const deleteSchema = z.object({ path: pathSchema });

  const writeFile: Tool<{ path: string; content: string }, { written: true }> = {
    name: "write_file",
    description: "Create or overwrite a UTF-8 text file inside the project workspace.",
    permissionCategory: "write_project_file",
    inputSchema: writeSchema,
    async execute(input) {
      await workspace.writeFile(input.path, input.content);
      return { written: true };
    },
  };

  const readFile: Tool<{ path: string }, { content: string }> = {
    name: "read_file",
    description: "Read a UTF-8 text file from the project workspace.",
    permissionCategory: "read_project_file",
    inputSchema: readSchema,
    async execute(input) {
      return { content: await workspace.readFile(input.path) };
    },
  };

  const readRange: Tool<{ path: string; offsetLines?: number; count?: number }, { lines: string[] }> = {
    name: "read_range",
    description: "Read a bounded range of lines from a project text file.",
    permissionCategory: "read_project_file",
    inputSchema: z.object({
      path: pathSchema,
      offsetLines: z.number().int().nonnegative().default(0),
      count: z.number().int().positive().max(1000).default(200),
    }),
    async execute(input) {
      return { lines: await workspace.readRange(input.path, input.offsetLines ?? 0, input.count ?? 200) };
    },
  };

  const listTree: Tool<{ subdir?: string; depth?: number }, { entries: Array<{ relativePath: string; isDirectory: boolean; sizeBytes: number }> }> = {
    name: "list_tree",
    description: "List files and directories in the project workspace, optionally below a subdirectory.",
    permissionCategory: "read_project_file",
    inputSchema: z.object({
      subdir: z.string().max(1024).optional(),
      depth: z.number().int().min(0).max(10).optional(),
    }),
    async execute(input) {
      const entries = (await workspace.listTree(input.subdir ?? "", input.depth ?? 6)).slice(0, 2000).map((entry) => ({
        relativePath: entry.relativePath,
        isDirectory: entry.isDirectory,
        sizeBytes: entry.sizeBytes,
      }));
      return { entries };
    },
  };

  const createDirectory: Tool<{ path: string }, { created: true }> = {
    name: "create_directory",
    description: "Create a directory, including missing parents, inside the project workspace.",
    permissionCategory: "write_project_file",
    inputSchema: z.object({ path: pathSchema }),
    async execute(input) {
      await workspace.createDirectory(input.path);
      return { created: true };
    },
  };

  const deleteFile: Tool<{ path: string }, { deleted: true }> = {
    name: "delete_file",
    description: "Delete a file or directory inside the project workspace (approval-gated by default).",
    permissionCategory: "delete_file",
    inputSchema: deleteSchema,
    async execute(input, _ctx: ToolContext) {
      await workspace.deleteFile(input.path);
      return { deleted: true };
    },
  };

  const copyFile: Tool<{ from: string; to: string }, { copied: true }> = {
    name: "copy_file",
    description: "Copy a project file to another path inside the workspace.",
    permissionCategory: "write_project_file",
    inputSchema: z.object({ from: pathSchema, to: pathSchema }),
    async execute(input) {
      await workspace.copyFile(input.from, input.to);
      return { copied: true };
    },
  };

  const moveFile: Tool<{ from: string; to: string }, { moved: true }> = {
    name: "move_file",
    description: "Move or rename a project file inside the workspace.",
    permissionCategory: "write_project_file",
    inputSchema: z.object({ from: pathSchema, to: pathSchema }),
    async execute(input) {
      await workspace.moveFile(input.from, input.to);
      return { moved: true };
    },
  };

  const searchText: Tool<{ pattern: string; subdir?: string }, { hits: number; results: Array<{ relativePath: string; line: number; text: string }> }> = {
    name: "search_text",
    description: "Search for literal text across workspace files.",
    permissionCategory: "read_project_file",
    inputSchema: z.object({ pattern: z.string().min(1).max(500), subdir: z.string().max(1024).optional() }),
    async execute(input) {
      const results = await workspace.searchText(input.pattern, input.subdir ?? "");
      return {
        hits: results.length,
        results: results.map((result) => ({ relativePath: result.relativePath, line: result.line, text: result.text })),
      };
    },
  };

  const replaceText: Tool<{ path: string; search: string; replacement: string; all?: boolean }, { replacements: number }> = {
    name: "replace_text",
    description: "Replace exact text in a project file; returns the number of replacements.",
    permissionCategory: "write_project_file",
    inputSchema: z.object({
      path: pathSchema,
      search: z.string().min(1),
      replacement: z.string(),
      all: z.boolean().optional(),
    }),
    async execute(input) {
      return { replacements: await workspace.replaceText(input.path, input.search, input.replacement, input.all ?? true) };
    },
  };

  const fileMetadata: Tool<{ path: string }, { sizeBytes: number; modifiedAt: string }> = {
    name: "file_metadata",
    description: "Return file size and last modification time for a project path.",
    permissionCategory: "read_project_file",
    inputSchema: z.object({ path: pathSchema }),
    execute: (input) => workspace.fileMetadata(input.path),
  };

  const hashFile: Tool<{ path: string }, { sha256: string }> = {
    name: "hash_file",
    description: "Compute SHA-256 for a project file.",
    permissionCategory: "read_project_file",
    inputSchema: z.object({ path: pathSchema }),
    async execute(input) {
      return { sha256: await workspace.hashFile(input.path) };
    },
  };

  const diffFiles: Tool<{ a: string; b: string }, { diff: string }> = {
    name: "diff_files",
    description: "Create a text diff between two files in the project workspace.",
    permissionCategory: "read_project_file",
    inputSchema: z.object({ a: pathSchema, b: pathSchema }),
    async execute(input) {
      return { diff: await workspace.diffFiles(input.a, input.b) };
    },
  };

  const createZip: Tool<{ path: string }, { path: string; sha256: string }> = {
    name: "create_zip",
    description: "Create a ZIP export inside the workspace. Secrets, .agent, .git and node_modules are excluded by default.",
    permissionCategory: "write_project_file",
    inputSchema: z.object({ path: pathSchema.refine((value) => value.toLowerCase().endsWith(".zip"), "ZIP path must end with .zip") }),
    timeoutMs: 120_000,
    async execute(input) {
      const sha256 = await workspace.createZip(input.path, {
        exclude: [/(^|\/)node_modules\//, /(^|\/)\.env$/, /(^|\/)\.agent\//, /(^|\/)\.git\//, /(^|\/)exports\//],
      });
      return { path: input.path, sha256 };
    },
  };

  return [
    writeFile,
    readFile,
    readRange,
    listTree,
    createDirectory,
    deleteFile,
    copyFile,
    moveFile,
    searchText,
    replaceText,
    fileMetadata,
    hashFile,
    diffFiles,
    createZip,
  ];
}
