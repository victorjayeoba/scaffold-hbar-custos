#!/usr/bin/env node
// Validates template.json with the exact Zod schema the create-scaffold-hbar
// CLI uses (taken from the installed CLI, not a copy), then checks that every
// `{run:<script>}` in the outro names a script in the root package.json.
//
//   npm install --prefix /tmp/cli create-scaffold-hbar@latest
//   node scripts/check-template.mjs /tmp/cli/node_modules/create-scaffold-hbar
//
// Exits 1 on any problem.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliDir = process.argv[2];
if (!cliDir) {
  console.error("usage: node scripts/check-template.mjs <path to node_modules/create-scaffold-hbar>");
  process.exit(2);
}

const cliPkg = JSON.parse(readFileSync(path.join(cliDir, "package.json"), "utf8"));
const source = readFileSync(path.join(cliDir, cliPkg.main ?? "dist/cli.js"), "utf8");

// The schema block runs from the first schema constant to the end of TemplateManifestSchema.
const start = source.indexOf("const EnvVarSchema");
const endMarker = source.indexOf("const TemplateManifestSchema");
const end = source.indexOf("}));", endMarker);
if (start < 0 || endMarker < 0 || end < 0) {
  console.error(`create-scaffold-hbar ${cliPkg.version}: schema not found in the bundle; update this script`);
  process.exit(1);
}
const { z } = await import(pathToFileURL(createRequire(path.join(cliDir, "package.json")).resolve("zod")).href);
const TemplateManifestSchema = new Function("z", `${source.slice(start, end + 4)}\nreturn TemplateManifestSchema;`)(z);

const problems = [];
const manifest = JSON.parse(readFileSync(path.join(ROOT, "template.json"), "utf8"));
const parsed = TemplateManifestSchema.safeParse(manifest);
if (!parsed.success) {
  for (const issue of parsed.error.issues)
    problems.push(`template.json ${issue.path.join(".") || "(root)"}: ${issue.message}`);
}

const scripts = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts ?? {};
const outro = JSON.stringify(manifest["create-scaffold-hbar"]?.outro ?? {});
for (const [, script] of outro.matchAll(/\{run:([a-zA-Z0-9:_-]+)\}/g)) {
  // `{run:framework:x}` is expanded to the chosen framework (foundry here).
  const name = script.replace(/^framework:/, "foundry:");
  if (!(name in scripts)) problems.push(`template.json outro: {run:${script}} names no script in package.json`);
}

for (const problem of problems) console.log(problem);
console.log(
  `template.json against create-scaffold-hbar ${cliPkg.version} schema: ${problems.length ? `${problems.length} problem(s)` : "valid"}`,
);
process.exit(problems.length ? 1 : 0);
