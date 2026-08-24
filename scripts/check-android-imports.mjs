import fs from "node:fs";
import path from "node:path";

const roots = [
  "apps/android",
  ...[
    "agent-core", "agent-memory", "agent-mcp", "agent-models", "agent-net",
    "agent-persistence", "agent-platform", "agent-project", "agent-protocol",
    "agent-skills", "agent-team", "agent-workspace",
  ].map((name) => `packages/${name}/src`),
];
const allowed = new Set([
  path.normalize("packages/agent-platform/src/node.ts"),
  path.normalize("packages/agent-persistence/src/node.ts"),
]);
const forbidden = [
  { label: "node:* import", regex: /(?:from\s+|import\s*\(|require\s*\()\s*["']node:/ },
  { label: "Buffer global", regex: /\bBuffer\b/ },
  { label: "process.cwd", regex: /\bprocess\.cwd\s*\(/ },
];
const failures = [];

for (const root of roots) walk(root);

if (failures.length) {
  console.error("Forbidden Node APIs in Android execution path:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("Android import guard passed: no forbidden Node APIs in runtime source.");

function walk(relative) {
  if (!fs.existsSync(relative)) return;
  const stat = fs.statSync(relative);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(relative)) {
      if (["node_modules", "test", "tests", "android", ".expo"].includes(name)) continue;
      walk(path.join(relative, name));
    }
    return;
  }
  if (!/\.(ts|tsx)$/.test(relative) || allowed.has(path.normalize(relative))) return;
  const source = fs.readFileSync(relative, "utf8");
  for (const rule of forbidden) if (rule.regex.test(source)) failures.push(`${relative}: ${rule.label}`);
}
