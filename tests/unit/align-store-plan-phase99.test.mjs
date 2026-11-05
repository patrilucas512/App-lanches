import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Fase 99C. Prova no dev: scripts/dev/phase99c-align-check.sql (9 de 9 em 05/11/2026).
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/20261105121000_phase99c_align_store_plan.sql");

test("só o superadmin vê a prévia e aplica", () => {
  assert.equal((sql.match(/if not private\.is_superadmin\(\) then raise exception 'FORBIDDEN'/g) || []).length, 2);
  assert.match(sql, /revoke all on function public\.preview_store_plan_alignment\(uuid\) from public, anon;/);
  assert.match(sql, /revoke all on function public\.align_store_to_plan\(uuid, text, text\[\]\) from public, anon;/);
});

test("prévia: o que some, o que fica e o que foi usado em 30 dias; chaves só da loja nunca saem", () => {
  assert.match(sql, /if not \(plan_row \? k\) or coalesce\(\(plan_row->>k\)::boolean, false\) then continue; end if;/);
  assert.match(sql, /private\.store_module_used_recently\(requested_store_id, k, 30\)/);
  assert.match(sql, /'stays_by_plan'/);
  assert.match(sql, /'action', case when used then 'keep_used' else 'remove' end/);
});

test("aplicar exige o slug e não desliga módulo usado sem confirmação explícita", () => {
  assert.match(sql, /if requested_confirmation is distinct from \(preview->>'slug'\) then/);
  assert.match(sql, /if item->>'action' = 'remove' or \(item->>'flag'\) = any\(coalesce\(requested_confirm_used, '\{\}'\)\) then/);
  assert.match(sql, /set_config\('masterapp\.flag_actor', 'superadmin', true\)/);
});

test("a tela mostra a prévia antes e pede confirmação", () => {
  const ui = read("components/plan-alignment-panel.tsx");
  assert.match(ui, /rpc\("preview_store_plan_alignment"/);
  assert.match(ui, /disabled=\{busy \|\| confirmation !== preview\.slug\}/);
  assert.match(ui, /desligar mesmo assim/);
  assert.match(read("app/superadmin/estabelecimentos/[id]/page.tsx"), /<PlanAlignmentPanel storeId=\{store\.id\} \/>/);
  const check = read("scripts/dev/phase99c-align-check.sql");
  for (const s of ["dono não vê", "usado nos últimos 30 dias", "slug certo", "confirmação explícita", "auditoria", "anon"]) assert.ok(check.includes(s), s);
});
