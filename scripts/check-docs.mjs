#!/usr/bin/env node
// Doc-drift check: fails when README.md or AGENTS.md name something that does
// not exist in the repository. It reads the docs' inline code and code blocks
// and checks four kinds of reference:
//
//   commands   `yarn <script>`, `yarn workspace @sh/<pkg> <script>` and
//              `npm run <script>` must name a script in that package.json
//   files      `path/to/File.sol`, `script/Deploy.s.sol`, `foo.ts` and relative
//              Markdown links must exist (searched from the root and from each
//              package, so package-relative paths work)
//   routes     `/trade`, `/api/...` and http://localhost:3000/... must match a
//              page.tsx or route.ts under packages/nextjs/app
//   names      a PascalCase name in inline code (`PerpMarket`,
//              `ScheduledKeeper.tick()`) must appear in the source somewhere
//
// Placeholders (`<chainId>`, `{name}`, `*`, `$VAR`) are skipped. To skip one
// line on purpose, put <!-- drift-ignore --> on it.
//
//   node scripts/check-docs.mjs [doc ...]      (default: README.md AGENTS.md)
//
// Prints one line per problem and exits 1 if there are any.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = process.argv.length > 2 ? process.argv.slice(2) : ["README.md", "AGENTS.md"];
const PACKAGES = ["packages/foundry", "packages/nextjs"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "lib", "out", "cache", "broadcast", ".yarn", "dist"]);

const readJson = file => JSON.parse(readFileSync(path.join(ROOT, file), "utf8"));
const exists = rel => existsSync(path.join(ROOT, rel));

function walk(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

// ---- what exists ------------------------------------------------------------

// Scripts per package: the root, and each workspace by its package name.
const scripts = { root: readJson("package.json").scripts ?? {} };
for (const pkg of PACKAGES) {
  if (!exists(`${pkg}/package.json`)) continue;
  const json = readJson(`${pkg}/package.json`);
  scripts[json.name] = json.scripts ?? {};
}
// Yarn and npm commands that are not package scripts.
const BUILTINS = new Set(
  "add bin cache config constraints create dedupe dlx exec explain info init install link node npm pack patch plugin rebuild remove run set unlink unplug up upgrade version why workspaces ci i x".split(
    " ",
  ),
);

// Every file in the repo (minus deps and build output), for path and basename lookups.
const allFiles = walk(ROOT).map(f => path.relative(ROOT, f).split(path.sep).join("/"));
const basenames = new Set(allFiles.map(f => f.slice(f.lastIndexOf("/") + 1)));

// Identifiers in our own source: Solidity, scripts and the app, excluding generated ABIs.
const SOURCE_EXT = /\.(sol|ts|tsx|js|mjs|cjs)$/;
const identifiers = new Set();
for (const file of allFiles) {
  if (!file.startsWith("packages/") || !SOURCE_EXT.test(file)) continue;
  if (/\/contracts\/(deployedContracts|externalContracts)\.ts$/.test(file)) continue;
  for (const word of readFileSync(path.join(ROOT, file), "utf8").match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
    identifiers.add(word);
  }
}

// App routes from packages/nextjs/app: page.tsx and route.ts, as segment patterns.
const routes = allFiles
  .filter(f => /^packages\/nextjs\/app\/(.*\/)?(page\.(t|j)sx?|route\.(t|j)s)$/.test(f))
  .map(f =>
    f
      .replace(/^packages\/nextjs\/app/, "")
      .replace(/\/(page|route)\.[a-z]+$/, "")
      .split("/")
      .filter(seg => seg && !/^\(.*\)$/.test(seg)),
  );
function routeExists(url) {
  const segs = url
    .replace(/[?#].*$/, "")
    .split("/")
    .filter(Boolean);
  return routes.some(
    route =>
      (route.length === segs.length || route.at(-1)?.startsWith("[...")) &&
      segs.every((seg, i) => route[i] !== undefined && (route[i] === seg || route[i].startsWith("["))),
  );
}

// ---- what the docs say ------------------------------------------------------

const PLACEHOLDER = /[<>{}*$|]|\.\.\./;

// Scaffolding with npm, the CLI deletes the default package manager's lockfile and rewrites that package manager's
// name to "npm" in every text file, this script and the docs included, but renames no file. So a doc link such as
// `.harness/validators/<name>.json` points at a file that kept its old name. The name is built from halves so the
// rewrite leaves it intact here.
const YARN = ["y", "arn"].join("");
const NPM_SCAFFOLD = !exists(`${YARN}.lock`);
const problems = [];

function checkCommand(where, command) {
  // Normalise `npm run x -w @sh/pkg` and `yarn workspace @sh/pkg x` to (package, script).
  for (const m of command.matchAll(/\byarn\s+workspace\s+(@[\w-]+\/[\w-]+)\s+([\w:.-]+)/g)) {
    const [, pkg, script] = m;
    if (!scripts[pkg]) problems.push(`${where}: "${m[0]}": no workspace ${pkg}`);
    else if (!BUILTINS.has(script) && !(script in scripts[pkg]))
      problems.push(`${where}: "${m[0]}": ${pkg} has no "${script}" script`);
  }
  for (const m of command.matchAll(/\bnpm\s+run\s+([\w:.-]+)(?:\s+-w\s+(@[\w-]+\/[\w-]+))?/g)) {
    const [, script, pkg = "root"] = m;
    // In an npm scaffold the CLI rewrites `npm create scaffold-hbar` to `npm run create ...`; not ours to fix.
    if (script === "create" && !(script in scripts.root)) continue;
    if (!scripts[pkg]) problems.push(`${where}: "${m[0]}": no workspace ${pkg}`);
    else if (!(script in scripts[pkg])) problems.push(`${where}: "${m[0]}": no "${script}" script`);
  }
  for (const m of command.matchAll(/\byarn\s+([a-z][\w:.-]*)/g)) {
    const script = m[1];
    if (script === "workspace" || BUILTINS.has(script)) continue;
    if (!(script in scripts.root)) problems.push(`${where}: "${m[0]}": no "${script}" script in package.json`);
  }
}

function checkPath(where, ref) {
  const clean = ref
    .replace(/^\.\//, "")
    .replace(/[#?].*$/, "")
    .replace(/\/$/, "");
  if (!clean || PLACEHOLDER.test(clean)) return;
  // .env files are generated from .env.example and never committed.
  if (/(^|\/)\.env(\.local)?$/.test(clean)) return;
  // The CLI reads template.json and deletes it, so a scaffolded project never has it.
  if (clean === "template.json") return;
  const found = rel =>
    !rel.includes("/") ? basenames.has(rel) || exists(rel) : [".", ...PACKAGES].some(base => exists(path.posix.join(base, rel)));
  // An npm scaffold has the package-manager word rewritten in every doc, but its files keep their names.
  if (found(clean) || (NPM_SCAFFOLD && found(clean.replace(/\bnpm\b/g, YARN)))) return;
  problems.push(`${where}: "${ref}" does not exist`);
}

function checkRoute(where, route) {
  if (PLACEHOLDER.test(route)) return;
  if (!routeExists(route)) problems.push(`${where}: route "${route}" has no page or API route`);
}

function checkName(where, name) {
  if (!identifiers.has(name)) problems.push(`${where}: "${name}" is not defined anywhere in packages/`);
}

// A file reference: has a known extension, or is a path into a top-level folder.
const FILE_EXT = /\.(sol|ts|tsx|js|mjs|cjs|json|toml|md|yaml|yml|txt|sh|env|example|gif|png|jpg|svg|mp4)$/;
const TOP_DIRS = /^(packages|docs|scripts|\.github|\.harness)\//;

function checkInlineCode(where, code) {
  const text = code.trim();
  if (/^(yarn|npm)\s/.test(text)) return checkCommand(where, text);
  if (/^https?:\/\/localhost:3000/.test(text))
    return checkRoute(where, text.replace(/^https?:\/\/localhost:3000/, "") || "/");
  if (/\s/.test(text) || /^[a-z]+:\/\//.test(text)) return;
  if (/^\/[\w\-/[\].]*$/.test(text) && !FILE_EXT.test(text)) return checkRoute(where, text);
  if (FILE_EXT.test(text) || TOP_DIRS.test(text)) return checkPath(where, text);
  // `PascalCase`, `PascalCase.member` or `PascalCase(...)`: a contract or type name.
  const name = text.match(/^([A-Z][A-Za-z0-9_]*[a-z][A-Za-z0-9_]*)(?:$|[.(])/);
  if (name) checkName(where, name[1]);
}

for (const doc of DOCS) {
  if (!exists(doc)) {
    problems.push(`${doc}: missing`);
    continue;
  }
  const docDir = path.posix.dirname(doc);
  let fence = null;
  readFileSync(path.join(ROOT, doc), "utf8")
    .split(/\r?\n/)
    .forEach((line, index) => {
      const where = `${doc}:${index + 1}`;
      const toggle = line.match(/^\s*(```|~~~)/);
      if (toggle) {
        fence = fence ? null : toggle[1];
        return;
      }
      if (line.includes("<!-- drift-ignore -->")) return;
      if (fence) {
        // Code blocks: only commands are checked (diagrams and code samples are free text).
        if (/\b(yarn|npm run)\s/.test(line)) checkCommand(where, line.replace(/#.*$/, ""));
        return;
      }
      for (const [, code] of line.matchAll(/`([^`]+)`/g)) checkInlineCode(where, code);
      // Relative Markdown links and images.
      for (const [, target] of line.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        if (/^([a-z]+:|#|mailto:)/i.test(target)) continue;
        checkPath(where, path.posix.normalize(path.posix.join(docDir, decodeURI(target))));
      }
      for (const [url] of line.matchAll(/https?:\/\/localhost:3000[^\s)`'"]*/g)) {
        checkRoute(where, url.replace(/^https?:\/\/localhost:3000/, "") || "/");
      }
    });
}

const unique = [...new Set(problems)];
for (const problem of unique) console.log(problem);
console.log(`doc-drift: ${DOCS.join(", ")}: ${unique.length} problem${unique.length === 1 ? "" : "s"}`);
process.exit(unique.length ? 1 : 0);
