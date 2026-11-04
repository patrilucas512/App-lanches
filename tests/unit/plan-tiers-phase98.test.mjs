import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PILOT_PLAN_FLAGS, BASIC_PLAN_FLAGS, PROFESSIONAL_PLAN_FLAGS, NEW_MENU_FLAGS, STORE_ONLY_ADVANCED_FLAGS } from "../../lib/plan-tiers.ts";
import { isMenuItemEntitled, menuRuleKeys } from "../../lib/menu-entitlements.ts";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const pilotMigration = read("supabase/migrations/20261104131000_phase98b_pilot_plan.sql");
const cleanup = read("supabase/migrations/20261104132000_phase98b_plan_cleanup.sql");
const preview = read("scripts/dev/phase98b-plan-preview.sql");
const shell = read("components/dashboard-shell.tsx");

const sqlArray = (sql, name) => {
  const m = sql.match(new RegExp(`${name} text\\[\\] := (?:[a-z_]+ \\|\\| )?array\\[([^\\]]+)\\]`));
  assert.ok(m, `array ${name}`);
  return [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]);
};
const ownerMenu = shell.slice(shell.indexOf("const allLinks"), shell.indexOf("const attendantLinks"));
const allLinkKeys = [...ownerMenu.matchAll(/\{ key: "([^"]+)", href:/g)].map((m) => m[1]);

// Plano Piloto como o banco devolve: todas as flags desligadas, menos o núcleo. Loja sem linha em
// store_feature_flags (é o caso de quem se cadastra pelo /cadastro): só chaves operacionais da loja não existem.
const menuFlags = [...read("lib/menu-entitlements.ts").matchAll(/plan\.([a-z0-9_]+_enabled)/g)].map((m) => m[1]);
const everyFlag = new Set([...PROFESSIONAL_PLAN_FLAGS, ...NEW_MENU_FLAGS, ...STORE_ONLY_ADVANCED_FLAGS, ...menuFlags]);
const pilotPlan = Object.fromEntries([...everyFlag].map((k) => [k, false]));
for (const k of PILOT_PLAN_FLAGS) pilotPlan[k] = true;
pilotPlan.delivery_enabled = true;
pilotPlan.whatsapp_enabled = true;

test("plano Piloto mostra só o núcleo no menu", () => {
  const visible = allLinkKeys.filter((key) => isMenuItemEntitled(key, pilotPlan));
  assert.deepEqual(visible.sort(), [
    "attendance", "calls", "cashier", "catalog", "customize", "deliveries", "billing", "help", "kitchen",
    "notifications", "onboarding", "orders", "overview", "saas-support", "security", "settings", "team", "whatsapp-supervision",
  ].sort());
});

test("itens que não tinham flag passam a ter regra", () => {
  for (const key of ["intelligence", "analytics", "units", "inbox", "crm", "integrations", "integration-orchestration", "calls"]) {
    assert.ok(menuRuleKeys().includes(key), key);
    assert.equal(isMenuItemEntitled(key, pilotPlan), key === "calls", key);
  }
});

test("menu sem plano (superadmin vendo) e lojas atuais continuam iguais", () => {
  assert.equal(isMenuItemEntitled("digital-twin", null), true);
  const legacy = Object.fromEntries(Object.keys(pilotPlan).map((k) => [k, true]));
  assert.ok(allLinkKeys.filter((k) => k !== "voice").every((key) => isMenuItemEntitled(key, legacy)));
});

test("listas iguais no código, nas migrations e na prévia", () => {
  assert.deepEqual(sqlArray(pilotMigration, "pilot"), [...PILOT_PLAN_FLAGS]);
  assert.deepEqual(sqlArray(cleanup, "pilot"), [...PILOT_PLAN_FLAGS]);
  assert.deepEqual([...PILOT_PLAN_FLAGS, ...sqlArray(cleanup, "basic")], [...BASIC_PLAN_FLAGS]);
  assert.deepEqual([...BASIC_PLAN_FLAGS, ...sqlArray(cleanup, "professional")], [...PROFESSIONAL_PLAN_FLAGS]);
  assert.deepEqual(sqlArray(pilotMigration, "menu_flags"), [...NEW_MENU_FLAGS]);
  assert.deepEqual(sqlArray(pilotMigration, "store_only_advanced"), [...STORE_ONLY_ADVANCED_FLAGS]);
  assert.deepEqual(sqlArray(cleanup, "premium_extra"), [...STORE_ONLY_ADVANCED_FLAGS]);
  const previewArrays = [...preview.matchAll(/array\[([^\]]+)\]::text\[\] as ([a-z_]+)/g)].map((m) => [m[2], [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1])]);
  const p = Object.fromEntries(previewArrays);
  assert.deepEqual(p.basic, [...BASIC_PLAN_FLAGS]);
  assert.deepEqual([...BASIC_PLAN_FLAGS, ...p.professional_extra], [...PROFESSIONAL_PLAN_FLAGS]);
  assert.deepEqual(p.premium_extra, [...STORE_ONLY_ADVANCED_FLAGS]);
});

test("parte 1 é compatível com as lojas existentes", () => {
  assert.match(pilotMigration, /execute format\('update public\.plans set %I = true', c\);/);
  assert.match(pilotMigration, /alter column %I set default false/);
  assert.match(pilotMigration, /not \(s\.column_name = any\(operational\)\)/);
  assert.doesNotMatch(pilotMigration, /update public\.store_feature_flags/);
  assert.doesNotMatch(cleanup, /store_feature_flags set/);
});

test("Piloto fora da vitrine, sem preço e sem troca pelo próprio dono", () => {
  assert.match(pilotMigration, /select 'piloto', 'Piloto'/);
  assert.match(pilotMigration, /0, 0, b\.max_products/);
  assert.match(pilotMigration, /'\[\]'::jsonb, true, false, 0/);
  assert.match(pilotMigration, /from public\.plans p where p\.active and p\.is_public/);
  assert.match(pilotMigration, /and active and \(is_public or private\.is_superadmin\(\)\)/);
  assert.match(pilotMigration, /'where active and is_public order by \(lower\(code\)=''starter''\) desc'/);
  for (const path of ["app/painel/assinatura/page.tsx", "app/assinar/[code]/page.tsx", "app/api/saas/checkout/route.ts"]) {
    assert.match(read(path), /from\("plans"\)[^\n]*\.eq\("is_public", ?true\)/, path);
  }
});

test("prévia é só leitura", () => {
  assert.doesNotMatch(preview.replace(/--.*$/gm, ""), /\b(insert|update|delete|alter|drop|create)\b/i);
});
