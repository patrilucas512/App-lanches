// Privacy by design (Phase 95): a migration that adds a personal-looking column without an entry in personal_data_map gets a
// warning. It never fails the build: the column may not be personal, and mapping happens in Privacidade & LGPD too.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { detectPersonalColumns, unmappedPersonalColumns } from "../../lib/privacy-operations/core.ts";
const dir = "supabase/migrations";
const explicit = process.argv.slice(2);
const range = process.env.GITHUB_EVENT_NAME === "pull_request" ? ["HEAD^1...HEAD^2"] : ["HEAD^", "HEAD"];
let files = explicit;
if (!files.length) { try { files = execFileSync("git", ["diff", "--name-only", "--diff-filter=ACMR", ...range, "--", `${dir}/*.sql`], { encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean); } catch { files = []; } }
// Every map row declared by any migration counts, so mapping a column in a later file clears the warning.
const map = [];
for (const name of readdirSync(dir).filter((x) => x.endsWith(".sql"))) {
  const sql = readFileSync(`${dir}/${name}`, "utf8");
  for (const block of sql.matchAll(/insert into public\.personal_data_map\([^)]*\) values([\s\S]*?);/gi)) for (const row of block[1].matchAll(/\(\s*'[^']*'\s*,\s*'([a-z0-9_]+)'\s*,\s*'([a-z0-9_]+)'/gi)) map.push({ table_name: row[1], column_name: row[2] });
}
const warnings = [];
for (const file of files) warnings.push(...unmappedPersonalColumns(detectPersonalColumns(readFileSync(file, "utf8")), map).map((x) => `${file}: ${x.table}.${x.column}`));
for (const line of warnings) console.warn(`::warning::Coluna com cara de dado pessoal sem entrada em personal_data_map: ${line}`);
console.log(`Personal data map check: ${files.length} migration(s), ${warnings.length} warning(s).`);
