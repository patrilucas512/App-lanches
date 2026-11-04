// Fase 98G: classifica as funções SECURITY DEFINER executáveis por usuário logado.
// Uso: node scripts/quality/security-definer-inventory.mjs <arquivo-com-nomes> > saída.json
// O arquivo de nomes vem do banco (uma função por linha; "#T" no fim marca função de gatilho).
// Para cada função procura chamadas `.rpc("nome")` no código e decide o tipo de cliente:
//   user    → cliente com a sessão do usuário (createClient do navegador ou do servidor, getDashboardContext)
//   service → cliente administrativo (createAdminClient, service_role nas funções do Supabase)
// Também procura referências em SQL (migrations e scripts): chamadas de outras funções, gatilhos e pg_cron.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const names = readFileSync(process.argv[2], "utf8").split(/\s+/).filter(Boolean);
const CODE_DIRS = ["app", "lib", "components", "supabase/functions", "public", "scripts"];
const SQL_DIRS = ["supabase/migrations", "scripts/dev"];
const walk = (dir) => { try { return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? (n === "node_modules" ? [] : walk(p)) : [p]; }); } catch { return []; } };
const code = CODE_DIRS.flatMap(walk).filter((p) => [".ts", ".tsx", ".js", ".mjs", ".ps1"].includes(extname(p))).map((p) => ({ path: p.replaceAll("\\", "/"), text: readFileSync(p, "utf8") }));
const sql = SQL_DIRS.flatMap(walk).filter((p) => extname(p) === ".sql").map((p) => ({ path: p.replaceAll("\\", "/"), text: readFileSync(p, "utf8") }));

function clientKind(file, receiver) {
  const t = file.text;
  if (file.path.startsWith("supabase/functions/")) {
    // funções do Supabase: o cliente com SERVICE_ROLE é service; o criado com a chave anon + Authorization do usuário é user
    const decl = t.match(new RegExp(`(?:const|let)\\s+${receiver}\\s*=\\s*createClient\\(([^;]+)\\)`));
    if (decl && /SERVICE_ROLE|serviceKey|serviceRoleKey/i.test(decl[1])) return "service";
    if (decl) return "user";
    return /SERVICE_ROLE/.test(t) ? "service" : "user";
  }
  if (file.path.startsWith("public/")) return "anon";
  if (file.path.startsWith("scripts/")) return "script";
  const assign = t.match(new RegExp(`(?:const|let)\\s*\\{?[^=;]*\\b${receiver}\\b[^=;]*\\}?\\s*=\\s*(?:await\\s+)?([A-Za-z_.]+)\\(`));
  if (assign) {
    if (/createAdminClient/.test(assign[1])) return "service";
    if (/createClient|getDashboardContext|requireSuperadmin|getEmployeeContext|getPortalContext|getWaiterContext|getKitchenContext/.test(assign[1])) return "user";
  }
  if (/^(admin|adminClient|service|db)$/.test(receiver) && /createAdminClient/.test(t)) return "service";
  if (/\.admin$|^ctx$|^c$/.test(receiver) && /admin\.rpc|createAdminClient/.test(t)) return /\.admin$/.test(receiver) ? "service" : "unknown";
  if (/^(supabase|client|sb|browser)$/.test(receiver)) return "user";
  if (file.path.startsWith("components/")) return "user";
  return "unknown";
}

const out = [];
for (const raw of names) {
  const trigger = raw.endsWith("#T");
  const name = raw.replace(/#T$/, "");
  const calls = [];
  for (const file of code) {
    const re = new RegExp(`([A-Za-z_$][\\w$.]*)\\s*\\.rpc\\(\\s*["'\`]${name}["'\`]`, "g");
    for (const m of file.text.matchAll(re)) calls.push({ file: file.path, kind: clientKind(file, m[1].split(".").pop() === "admin" ? "admin" : m[1]) });
    if (!new RegExp(`\\.rpc\\(\\s*["'\`]${name}["'\`]`).test(file.text) && new RegExp(`\\b${name}\\b`).test(file.text)) calls.push({ file: file.path, kind: "mention" });
  }
  const sqlRefs = sql.filter((f) => {
    const body = f.text.replace(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b`, "gi"), "").replace(new RegExp(`(grant|revoke)[^;]*\\b${name}\\b[^;]*;`, "gi"), "").replace(new RegExp(`comment on function[^;]*\\b${name}\\b[^;]*;`, "gi"), "");
    return new RegExp(`\\b(public\\.)?${name}\\s*\\(`).test(body) || new RegExp(`execute\\s+(function|procedure)\\s+(public\\.)?${name}\\b`, "i").test(body);
  }).map((f) => f.path);
  const kinds = new Set(calls.map((c) => c.kind));
  let category;
  if (trigger) category = "interna (gatilho)";
  else if (kinds.has("user") || kinds.has("anon") || kinds.has("unknown")) category = "app";
  else if (kinds.has("service") || kinds.has("script") || sqlRefs.length) category = "interna";
  else if (kinds.has("mention")) category = "app";
  else category = "morta";
  out.push({ name, trigger, category, calls: [...new Set(calls.map((c) => `${c.kind}:${c.file}`))].slice(0, 6), sqlRefs: [...new Set(sqlRefs)].slice(0, 4) });
}
console.log(JSON.stringify(out, null, 1));
