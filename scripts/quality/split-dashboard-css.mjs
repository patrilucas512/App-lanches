// Fase 99F: tira do app/globals.css as regras que só o painel e o superadmin usam e grava em
// app/painel/dashboard.css (importado pelo DashboardShell e pelo SuperadminShell).
// Uma regra fica no globals se QUALQUER classe dela aparecer em algum arquivo alcançável pelas rotas que não são
// painel nem superadmin (cardápio, portal do cliente, equipe, login, cadastro, site). Classes montadas com
// template (`status-${x}`) contam pelo prefixo. Regras sem classe (elementos, :root, @keyframes, @font-face) ficam.
// Uso: node scripts/quality/split-dashboard-css.mjs [--check]   (--check só informa, não grava)
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const root = process.cwd();
const check = process.argv.includes("--check");
const STOP = new Set(["components/dashboard-shell.tsx", "components/superadmin-shell.tsx"].map((p) => resolve(root, p)));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const appFiles = walk(join(root, "app")).filter((p) => /\.(tsx|ts)$/.test(p));
const entries = appFiles.filter((p) => /[\\/](page|layout|not-found|error|loading|template)\.tsx$/.test(p))
  .filter((p) => !/[\\/]app[\\/](painel|superadmin)[\\/]/.test(p) || /[\\/]painel[\\/]qrcodes[\\/]/.test(p));

function resolveImport(from, spec) {
  let base;
  if (spec.startsWith("@/")) base = resolve(root, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) {
    const p = base + ext;
    if (existsSync(p) && statSync(p).isFile() && /\.(tsx|ts)$/.test(p)) return p;
  }
  return null;
}
const seen = new Set();
const stack = [...entries];
while (stack.length) {
  const file = stack.pop();
  if (seen.has(file) || STOP.has(file)) continue;
  seen.add(file);
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/(?:import|export)[^"'`]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
    const next = resolveImport(file, m[1] || m[2]);
    if (next) stack.push(next);
  }
}
const publicText = [...seen].map((f) => readFileSync(f, "utf8")).join("\n");
const usedMemo = new Map();
function used(cls) {
  if (usedMemo.has(cls)) return usedMemo.get(cls);
  let ok = new RegExp(`(^|[^A-Za-z0-9_-])${cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z0-9_-])`).test(publicText);
  const parts = cls.split("-");
  for (let k = 1; !ok && k < parts.length; k++) if (publicText.includes(parts.slice(0, k).join("-") + "-${")) ok = true;
  usedMemo.set(cls, ok);
  return ok;
}

// separa blocos de primeiro nível (respeitando comentários e strings simples)
function blocks(css) {
  const out = []; let depth = 0, start = 0, i = 0;
  while (i < css.length) {
    if (css.startsWith("/*", i)) { i = css.indexOf("*/", i + 2) + 2; continue; }
    const c = css[i];
    if (c === "\"" || c === "'") { const end = css.indexOf(c, i + 1); i = end + 1; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { out.push(css.slice(start, i + 1)); start = i + 1; } }
    else if (c === ";" && depth === 0) { out.push(css.slice(start, i + 1)); start = i + 1; }
    i++;
  }
  if (css.slice(start).trim()) out.push(css.slice(start));
  return out;
}
function keep(rule) {
  const head = rule.slice(0, rule.indexOf("{")).replace(/\/\*[\s\S]*?\*\//g, "");
  const classes = [...head.matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)].map((m) => m[1]);
  if (!classes.length) return true;
  return classes.some(used);
}
if (process.argv.includes("--verify")) {
  // falha se alguma classe que só existe no dashboard.css passou a ser usada por uma rota pública
  const dash = readFileSync(join(root, "app/painel/dashboard.css"), "utf8");
  const leaked = [...new Set([...dash.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)(?=[^{}]*\{)/g)].map((m) => m[1]))]
    .filter((cls) => used(cls))
    .filter((cls) => !readFileSync(join(root, "app/globals.css"), "utf8").includes(`.${cls}`));
  if (leaked.length) {
    console.error(`classes do dashboard.css usadas fora do painel: ${leaked.join(", ")}`);
    process.exit(1);
  }
  console.log(`ok: nenhuma classe exclusiva do painel em rota pública (${seen.size} arquivos públicos)`);
  process.exit(0);
}
const css = readFileSync(join(root, "app/globals.css"), "utf8");
const stay = [], move = [];
for (const block of blocks(css)) {
  const head = block.trimStart();
  if (/^@media|^@supports|^@container/.test(head)) {
    const open = block.indexOf("{"), inner = block.slice(open + 1, block.lastIndexOf("}"));
    const a = [], b = [];
    for (const r of blocks(inner)) (keep(r) ? a : b).push(r);
    const prelude = block.slice(0, open + 1);
    if (a.join("").trim()) stay.push(prelude + a.join("") + "}");
    if (b.join("").trim()) move.push(prelude.trimStart() + b.join("") + "}\n");
  } else if (/^@/.test(head) || keep(block)) stay.push(block);
  else move.push(block.trimStart() + "\n");
}
const kb = (s) => `${Math.round(Buffer.byteLength(s) / 1024)} KB`;
console.log(`arquivos públicos alcançados: ${seen.size}; globals ${kb(css)} → ${kb(stay.join(""))}; painel ${kb(move.join(""))}`);
if (!check) {
  writeFileSync(join(root, "app/globals.css"), stay.join("").trimEnd() + "\n");
  writeFileSync(join(root, "app/painel/dashboard.css"), "/* Fase 99F: regras usadas só no painel e no superadmin (geradas por scripts/quality/split-dashboard-css.mjs). */\n" + move.join(""));
}
