import type { PlatformAdapters } from "@agentmoataz/agent-platform";
import { Workspace } from "@agentmoataz/agent-workspace";
import {
  AgentRuntime,
  ArtifactManager,
  CheckpointManager,
  EventBus,
  ModelDrivenPlanner,
  PermissionEngine,
  ToolRegistry,
  buildCoreFileTools,
  runToolLoop,
} from "@agentmoataz/agent-core";
import { AgentTeam } from "@agentmoataz/agent-team";
import type { ModelProvider } from "@agentmoataz/agent-models";

export type ProjectKind = "html-calculator" | "typescript-cli" | "expo-counter" | "expo-todo" | "custom";

export interface GenerationResult {
  projectName: string;
  kind: ProjectKind;
  workspaceRoot: string;
  filesCreated: string[];
  zipPath: string | null;
  zipChecksum: string | null;
  artifactId: string | null;
  report: string;
  reviewApproved: boolean;
  reviewIssues: string[];
  runCompleted: boolean;
  validation: ValidationReport;
  plan: string[];
}

export interface ValidationReport {
  passed: boolean;
  checksRun: string[];
  errors: string[];
  heavyBuild: "not_run" | "passed" | "failed";
  heavyBuildReason: string;
}

export interface GenerateOptions {
  goal: string;
  projectName: string;
  parentDir: string;
  provider: ModelProvider;
  platform: PlatformAdapters;
  kind?: ProjectKind;
  permissions?: PermissionEngine;
}

interface ProjectFile { p: string; c: string }

export function detectProjectKind(goal: string): ProjectKind {
  const value = goal.toLowerCase();
  if (value.includes("calculator") || value.includes("آلة حاسبة")) return "html-calculator";
  if (value.includes("cli") || value.includes("command line")) return "typescript-cli";
  if (value.includes("counter") || value.includes("عداد")) return "expo-counter";
  if (value.includes("todo") || value.includes("مهام")) return "expo-todo";
  return "custom";
}

export function fixtureFiles(kind: ProjectKind, name: string): ProjectFile[] {
  switch (kind) {
    case "html-calculator":
      return htmlCalculator(name);
    case "typescript-cli":
      return typescriptCli(name);
    case "expo-counter":
      return expoCounter(name);
    case "expo-todo":
      return expoTodo(name);
    default:
      return [
        { p: "README.md", c: `# ${name}\n\nCustom project generated from the user goal.\n` },
        { p: ".gitignore", c: ".env\nnode_modules/\ndist/\n" },
      ];
  }
}

/** Fixture/example workflow used for deterministic validation and demos. */
export async function generateProject(options: GenerateOptions): Promise<GenerationResult> {
  const kind = options.kind ?? detectProjectKind(options.goal);
  const workspaceRoot = options.platform.path.join(options.parentDir, options.projectName);
  await options.platform.fs.mkdir(workspaceRoot);
  const workspace = new Workspace(workspaceRoot, options.platform);
  const events = new EventBus();
  const tools = new ToolRegistry();
  for (const tool of buildCoreFileTools(workspace)) tools.register(tool);
  const checkpoints = new CheckpointManager(workspaceRoot, options.platform);
  const artifacts = new ArtifactManager(options.platform);
  const team = new AgentTeam({ reviewer: AgentTeam.strictReviewer(), crypto: options.platform.crypto });
  const planner = new ModelDrivenPlanner(options.provider);
  const planned = await planner.plan(
    { goal: options.goal },
    { capabilities: tools.list().map((tool) => tool.name), workspaceSummary: "new empty project" }
  );

  const runtime = new AgentRuntime({
    providers: [options.provider],
    events,
    tools,
    checkpoints,
    artifacts,
    crypto: options.platform.crypto,
    workspaceRoot,
    ...(options.permissions ? { permissions: options.permissions } : {}),
    perToolTimeoutMs: 10_000,
    maxSteps: 40,
  });

  const files = fixtureFiles(kind, options.projectName);
  runtime.setStepTools("Write project files", files.map((file) => ({ name: "write_file", input: { path: file.p, content: file.c } })));
  runtime.setStepTools("Verify required files", files.slice(0, Math.min(3, files.length)).map((file) => ({ name: "read_file", input: { path: file.p } })));
  const runResult = await runtime.runWithPlan(
    [
      { title: "Understand goal", goal: options.goal },
      { title: "Write project files", expectedTools: ["write_file"] },
      { title: "Verify required files", expectedTools: ["read_file"] },
    ],
    options.goal
  );

  const validation = await validateProject(workspace, kind);
  const changes = files.map((file) => `+ ${file.p} (${file.c.split("\n").length} lines)`).join("\n");
  const verdict = await team.review({
    changes,
    acceptanceCriteria: validation.passed ? ["local structural validation passed"] : validation.errors.map((error) => `FAIL: ${error}`),
  });

  const report = buildReport(options, kind, files, validation, runResult.state, verdict.approved);
  await workspace.writeFile("PROJECT_REPORT.md", report);
  await checkpoints.create("before packaging generated project");

  let zipChecksum: string | null = null;
  let zipPath: string | null = null;
  let artifactId: string | null = null;
  if (validation.passed && verdict.approved) {
    zipChecksum = await workspace.createZip(`exports/${options.projectName}.zip`);
    zipPath = options.platform.path.join(workspaceRoot, "exports", `${options.projectName}.zip`);
    artifactId = (await artifacts.register({ projectId: options.projectName, type: "source_zip", absolutePath: zipPath })).id;
  }

  return {
    projectName: options.projectName,
    kind,
    workspaceRoot,
    filesCreated: [...files.map((file) => file.p), "PROJECT_REPORT.md"],
    zipPath,
    zipChecksum,
    artifactId,
    report,
    reviewApproved: verdict.approved,
    reviewIssues: verdict.issues,
    runCompleted: runResult.state === "completed",
    validation,
    plan: planned.map((step) => step.title),
  };
}

/** Production path: the configured real model selects and invokes tools. */
export async function generateModelDrivenProject(options: GenerateOptions): Promise<ReturnType<typeof runToolLoop>> {
  const workspaceRoot = options.platform.path.join(options.parentDir, options.projectName);
  await options.platform.fs.mkdir(workspaceRoot);
  const workspace = new Workspace(workspaceRoot, options.platform);
  const tools = new ToolRegistry();
  for (const tool of buildCoreFileTools(workspace)) tools.register(tool);
  return runToolLoop(options.goal, {
    provider: options.provider,
    tools,
    permissions: options.permissions ?? new PermissionEngine("BALANCED"),
    systemPrompt: "You are a coding agent. Create or edit files with tools. Verify by reading files, then provide a final summary.",
  });
}

export async function validateProject(workspace: Workspace, kind: ProjectKind): Promise<ValidationReport> {
  const checksRun: string[] = [];
  const errors: string[] = [];
  const required: Record<ProjectKind, string[]> = {
    "html-calculator": ["index.html", "styles.css", "script.js", "README.md"],
    "typescript-cli": ["package.json", "src/index.ts", "tsconfig.json", "README.md"],
    "expo-counter": ["package.json", "App.tsx", "tsconfig.json", "README.md"],
    "expo-todo": ["package.json", "App.tsx", "tsconfig.json", "README.md"],
    custom: ["README.md"],
  };
  const entries = new Set((await workspace.listTree()).filter((entry) => !entry.isDirectory).map((entry) => entry.relativePath));
  checksRun.push("required files");
  for (const file of required[kind]) if (!entries.has(file)) errors.push(`missing required file: ${file}`);
  if (entries.has("package.json")) {
    checksRun.push("package.json parse");
    try { JSON.parse(await workspace.readFile("package.json")); } catch { errors.push("package.json is invalid JSON"); }
  }
  checksRun.push("secret exclusion policy");
  if (entries.has(".env")) errors.push("real .env must not be generated");
  return {
    passed: errors.length === 0,
    checksRun,
    errors,
    heavyBuild: "not_run",
    heavyBuildReason: "No cloud sandbox configured; structural checks only. Build success is not claimed.",
  };
}

function buildReport(options: GenerateOptions, kind: ProjectKind, files: ProjectFile[], validation: ValidationReport, runState: string, approved: boolean): string {
  return [
    "# PROJECT_REPORT", "", `- objective: ${options.goal}`, `- project kind: ${kind}`,
    `- files created: ${files.map((file) => file.p).join(", ")}, PROJECT_REPORT.md`,
    `- validation performed: ${validation.passed ? "passed" : "failed"} (${validation.checksRun.join(", ")})`,
    `- heavy build: ${validation.heavyBuild} — ${validation.heavyBuildReason}`,
    `- agent run: ${runState}`, `- reviewer: ${approved ? "approved" : "rejected"}`,
    "- known limitations: dependencies were not installed and a native build was not run.", "",
  ].join("\n");
}

function htmlCalculator(name: string): ProjectFile[] {
  return [
    { p: "index.html", c: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${name}</title><link rel="stylesheet" href="styles.css"></head><body><main><input id="display" readonly><div id="keys"></div></main><script src="script.js"></script></body></html>` },
    { p: "styles.css", c: ":root{color-scheme:light dark}body{font-family:system-ui;display:grid;place-items:center;min-height:100vh}main{width:min(22rem,90vw)}#display{box-sizing:border-box;width:100%;font-size:2rem;padding:1rem}#keys{display:grid;grid-template-columns:repeat(4,1fr);gap:.5rem;margin-top:.5rem}button{padding:1rem;font-size:1.1rem}" },
    { p: "script.js", c: "const d=document.querySelector('#display'),k=document.querySelector('#keys');const keys=['7','8','9','/','4','5','6','*','1','2','3','-','0','.','=','+'];for(const x of keys){const b=document.createElement('button');b.textContent=x;b.onclick=()=>x==='='?calculate():d.value+=x;k.append(b)}function calculate(){try{d.value=Function(`return (${d.value})`)()}catch{d.value='Error'}}addEventListener('keydown',e=>{if(/[0-9+\\-*/.]/.test(e.key))d.value+=e.key;if(e.key==='Enter')calculate();if(e.key==='Escape')d.value=''})" },
    { p: "README.md", c: `# ${name}\n\nResponsive HTML calculator with keyboard support. Open index.html in a browser.\n` },
  ];
}

function typescriptCli(name: string): ProjectFile[] {
  return [
    { p: "package.json", c: JSON.stringify({ name, version: "0.1.0", type: "module", bin: { [name]: "dist/index.js" }, scripts: { build: "tsc", start: "node dist/index.js" }, devDependencies: { typescript: "^5.9.2", "@types/node": "^24.0.0" } }, null, 2) },
    { p: "tsconfig.json", c: JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, outDir: "dist" }, include: ["src"] }, null, 2) },
    { p: "src/index.ts", c: "#!/usr/bin/env node\nconst args = process.argv.slice(2);\nconsole.log(args.length ? args.join(' ') : 'Hello from CLI');\n" },
    { p: "README.md", c: `# ${name}\n\nSmall strict TypeScript CLI. Run npm install, npm run build, then npm start.\n` },
  ];
}

function expoBase(name: string): ProjectFile[] {
  return [
    { p: "package.json", c: JSON.stringify({ name, version: "0.1.0", private: true, main: "node_modules/expo/AppEntry.js", scripts: { start: "expo start", android: "expo run:android" }, dependencies: { expo: "~52.0.0", react: "18.3.1", "react-native": "0.76.5" }, devDependencies: { typescript: "^5.9.2", "@types/react": "~18.3.12" } }, null, 2) },
    { p: "tsconfig.json", c: JSON.stringify({ extends: "expo/tsconfig.base", compilerOptions: { strict: true } }, null, 2) },
    { p: "README.md", c: `# ${name}\n\nExpo + strict TypeScript app. Run npm install then npx expo start.\n` },
  ];
}

function expoCounter(name: string): ProjectFile[] {
  return [...expoBase(name), { p: "App.tsx", c: "import {useState} from 'react';import {View,Text,Button,StyleSheet} from 'react-native';export default function App(){const[n,setN]=useState(0);return <View style={s.root}><Text style={s.n}>{n}</Text><Button title='Increment' onPress={()=>setN(v=>v+1)}/></View>}const s=StyleSheet.create({root:{flex:1,alignItems:'center',justifyContent:'center',gap:16},n:{fontSize:48,fontWeight:'700'}});" }];
}

function expoTodo(name: string): ProjectFile[] {
  return [...expoBase(name), { p: "App.tsx", c: "import {useState} from 'react';import {View,TextInput,Button,Text} from 'react-native';export default function App(){const[t,setT]=useState(''),[items,setItems]=useState<string[]>([]);return <View style={{padding:24,paddingTop:64}}><TextInput value={t} onChangeText={setT} placeholder='New todo'/><Button title='Add' onPress={()=>{if(t.trim()){setItems(v=>[...v,t.trim()]);setT('')}}}/>{items.map((x,i)=><Text key={i}>{x}</Text>)}</View>}" }];
}
