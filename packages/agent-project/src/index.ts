/**
 * agent-project — project-generation workflow.
 *
 * USER GOAL -> understand -> plan -> write files incrementally -> validate ->
 * repair -> REVIEW -> README + PROJECT_REPORT.md -> checkpoint -> ZIP ->
 * checksum -> artifact -> complete only after verification.
 */
import path from "node:path";
import fsp from "node:fs/promises";
import { Workspace } from "@agentmoataz/agent-workspace";
import {
  AgentRuntime,
  ArtifactManager,
  CheckpointManager,
  EventBus,
  PermissionEngine,
  ToolRegistry,
  buildCoreFileTools,
} from "@agentmoataz/agent-core";
import { AgentTeam } from "@agentmoataz/agent-team";
import type { ModelProvider } from "@agentmoataz/agent-models";

export interface GenerationResult {
  projectName: string;
  workspaceRoot: string;
  filesCreated: string[];
  zipPath: string | null;
  zipChecksum: string | null;
  artifactId: string | null;
  report: string;
  reviewApproved: boolean;
  reviewIssues: string[];
  runCompleted: boolean;
}

export interface GenerateOptions {
  goal: string;
  projectName: string;
  parentDir: string;
  provider: ModelProvider;
  permissions?: PermissionEngine;
}

/* ------------------------------------------------------------------ */
/* Templates (minimal, verified Expo + TypeScript todo app)            */
/* ------------------------------------------------------------------ */

function templateFiles(projectName: string): Array<{ p: string; c: string }> {
  const pkg = JSON.stringify(
    {
      name: projectName,
      version: "0.1.0",
      private: true,
      main: "index.ts",
      scripts: { start: "expo start", android: "expo run:android" },
      dependencies: { expo: "~52.0.0", "expo-status-bar": "~2.0.0", react: "18.3.1", "react-native": "0.76.5" },
      devDependencies: { typescript: "^5.9.2", "@types/react": "~18.3.12" },
    },
    null,
    2
  );
  return [
    {
      p: "package.json",
      c: pkg,
    },
    {
      p: "tsconfig.json",
      c: JSON.stringify(
        { extends: "expo/tsconfig.base", compilerOptions: { strict: true }, include: ["**/*.ts", "**/*.tsx"] },
        null,
        2
      ),
    },
    {
      p: "App.tsx",
      c: `import React, { useState } from "react";
import { View, Text, TextInput, Pressable, FlatList, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";

interface Todo { id: number; text: string; }

export default function App() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [draft, setDraft] = useState("");

  const add = () => {
    if (!draft.trim()) return;
    setTodos((t) => [...t, { id: Date.now(), text: draft.trim() }]);
    setDraft("");
  };

  const remove = (id: number) => setTodos((t) => t.filter((x) => x.id !== id));

  return (
    <View style={s.wrap}>
      <StatusBar style="auto" />
      <Text style={s.title}>Todo</Text>
      <View style={s.row}>
        <TextInput style={s.input} value={draft} onChangeText={setDraft} placeholder="New todo" />
        <Pressable style={s.btn} onPress={add}><Text style={s.btnTxt}>Add</Text></Pressable>
      </View>
      <FlatList
        data={todos}
        keyExtractor={(x) => String(x.id)}
        renderItem={({ item }) => (
          <Pressable onPress={() => remove(item.id)} style={s.item}>
            <Text>{item.text}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, padding: 20, paddingTop: 60 },
  title: { fontSize: 28, fontWeight: "700", marginBottom: 12 },
  row: { flexDirection: "row", gap: 8, marginBottom: 12 },
  input: { flex: 1, borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 8 },
  btn: { backgroundColor: "#2563eb", borderRadius: 8, paddingHorizontal: 14, justifyContent: "center" },
  btnTxt: { color: "#fff" },
  item: { padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "#ddd" },
});
`,
    },
    { p: ".gitignore", c: "node_modules/\n.expo/\n.env\n" },
    {
      p: "README.md",
      c: `# ${projectName}\n\nExpo + TypeScript todo app with local state.\n\n## Run\n\n\`\`\`bash\nnpm install\nnpx expo start\n\`\`\`\n`,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Workflow                                                            */
/* ------------------------------------------------------------------ */

export async function generateProject(opts: GenerateOptions): Promise<GenerationResult> {
  const workspaceRoot = path.join(opts.parentDir, opts.projectName);
  await fsp.mkdir(workspaceRoot, { recursive: true });
  const workspace = new Workspace(workspaceRoot);

  // ---- runtime assembly ----
  const events = new EventBus();
  const tools = new ToolRegistry();
  for (const t of buildCoreFileTools(workspace)) tools.register(t);
  const checkpoints = new CheckpointManager(workspaceRoot);
  const artifacts = new ArtifactManager();
  const team = new AgentTeam({ reviewer: AgentTeam.strictReviewer() });

  const runtime = new AgentRuntime({
    providers: [opts.provider],
    events,
    tools,
    checkpoints,
    artifacts,
    ...(opts.permissions ? { permissions: opts.permissions } : {}),
    perToolTimeoutMs: 10_000,
    maxSteps: 40,
  });

  const files = templateFiles(opts.projectName);
  runtime.setStepTools(
    "Execute primary work",
    files.map((f) => ({ name: "write_file", input: { path: f.p, content: f.c } }))
  );
  runtime.setStepTools("Verify results", [
    { name: "read_file", input: { path: "package.json" } },
    { name: "read_file", input: { path: "App.tsx" } },
  ]);

  const runResult = await runtime.runWithPlan(
    [
      { title: "Understand goal and gather context", goal: opts.goal },
      { title: "Execute primary work", expectedTools: ["write_file"] },
      { title: "Verify results", expectedTools: ["read_file"] },
    ],
    opts.goal
  );

  // ---- validation: package.json must actually parse ----
  let pkgValid = false;
  try {
    JSON.parse(await workspace.readFile("package.json"));
    pkgValid = true;
  } catch {
    pkgValid = false;
  }
  if (!pkgValid) {
    await workspace.writeFile("package.json", templateFiles(opts.projectName)[0]!.c);
  }

  // ---- Reviewer gate ----
  const changes = files.map((f) => `+ ${f.p} (${f.c.split("\n").length} lines)`).join("\n");
  const verdict = await team.review({
    changes,
    acceptanceCriteria: pkgValid ? ["package.json parses"] : ["missing valid manifest"],
  });

  // ---- PROJECT_REPORT.md ----
  const report = [
    "# PROJECT_REPORT",
    "",
    `- objective: ${opts.goal}`,
    "- architecture: Expo + TypeScript single-screen todo app with local state",
    `- files created: ${files.map((f) => f.p).join(", ")}, PROJECT_REPORT.md`,
    "- dependencies: expo, react, react-native, typescript",
    `- validation performed: ${pkgValid ? "package.json parsed; files read back via read_file" : "repair applied after parse failure"}`,
    `- test/build result: run ${runResult.state}; reviewer ${verdict.approved ? "approved" : "rejected"}`,
    `- known limitations: local state only; no persistence module yet`,
    "- next steps: add AsyncStorage persistence and tests",
    "",
  ].join("\n");
  await workspace.writeFile("PROJECT_REPORT.md", report);

  // ---- checkpoint ----
  const cp = await checkpoints.create("before packaging generated project");

  // ---- ZIP + checksum + artifact ----
  let zipChecksum: string | null = null;
  let artifactId: string | null = null;
  let zipPath: string | null = null;
  if (verdict.approved) {
    zipChecksum = await workspace.createZip(`exports/${opts.projectName}.zip`);
    zipPath = path.join(workspaceRoot, "exports", `${opts.projectName}.zip`);
    const art = await artifacts.register({
      projectId: opts.projectName,
      type: "source_zip",
      absolutePath: zipPath,
    });
    artifactId = art.id;
  }

  return {
    projectName: opts.projectName,
    workspaceRoot,
    filesCreated: [...files.map((f) => f.p), "PROJECT_REPORT.md"],
    zipPath,
    zipChecksum,
    artifactId,
    report,
    reviewApproved: verdict.approved,
    reviewIssues: verdict.issues,
    runCompleted: runResult.state === "completed",
  };
}
