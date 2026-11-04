import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { MODULE_RULES, isMenuItemEntitled, moduleOffReason } from "../../lib/menu-entitlements.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const walk = (dir) => readdirSync(join(root, dir)).flatMap((name) => {
  const path = join(dir, name);
  return statSync(join(root, path)).isDirectory() ? walk(path) : [path.replaceAll("\\", "/")];
});
const pages = [...walk("app/painel"), ...walk("app/home")].filter((p) => p.endsWith("page.tsx"));
const allOff = Object.fromEntries(Object.values(MODULE_RULES).flatMap((r) => r.flags).map((f) => [f, false]));

test("toda tela de módulo com flag mostra o aviso padrão quando a flag está desligada", () => {
  const shell = read("components/dashboard-shell.tsx");
  assert.match(shell, /const moduleOff = Boolean\(plan\) && !isMenuItemEntitled\(active, plan as MenuPlan \| null\)/);
  assert.match(shell, /\{moduleOff \? <ModuleUnavailable moduleKey=\{active\}/);
  let covered = 0;
  for (const page of pages) {
    const source = read(page);
    for (const [, key] of source.matchAll(/active=\{?"([a-z0-9-]+)"/g)) {
      if (!MODULE_RULES[key]) continue;
      covered++;
      assert.equal(isMenuItemEntitled(key, allOff), false, `${page}: ${key} deveria ficar bloqueada`);
    }
  }
  assert.ok(covered >= 70, `telas cobertas: ${covered}`);
});

test("nenhuma tela volta mais para o painel em silêncio por causa de flag", () => {
  const silent = [];
  let redirected = 0;
  for (const page of pages) {
    const source = read(page);
    for (const m of source.matchAll(/_enabled\s*===\s*false\s*\)\s*redirect\((["'])([^"']*)\1\)/g)) {
      if (m[2].startsWith("/painel/modulo-indisponivel?m=")) {
        redirected++;
        assert.ok(MODULE_RULES[m[2].split("=")[1]], `${page}: módulo ${m[2]}`);
      } else if (page !== "app/home/page.tsx") silent.push(`${page} → ${m[2]}`); // /home desligada cai no /painel padrão (Fase 53)
    }
  }
  assert.deepEqual(silent, []);
  assert.ok(redirected >= 36, `redirecionamentos: ${redirected}`);
});

test("o painel lê o plano da assinatura (objeto, não lista)", () => {
  const dashboard = read("lib/dashboard.ts");
  assert.doesNotMatch(dashboard, /subscriptions\?\.\[0\]\?\.plans\?\.\[0\]/);
  assert.match(dashboard, /Array\.isArray\(rawPlan\) \? rawPlan\[0\] : rawPlan/);
  assert.match(dashboard, /basePlan: unmergedPlan/);
});

test("o aviso diz o motivo e a ação certa para cada papel", () => {
  const ui = read("components/module-unavailable.tsx");
  assert.match(ui, /Módulo não disponível/);
  assert.match(ui, /não faz parte do plano desta loja/);
  assert.match(ui, /está desligado para esta loja pelo administrador/);
  assert.match(ui, /const isOwner = role === "owner";/);
  assert.match(ui, /href="\/painel\/assinatura">Ver planos</);
  assert.match(ui, /Fale com o responsável pela loja/);
  // motivo: flag controlada pelo plano → "plan"; só chave da loja (entrega, WhatsApp) → "store"
  assert.equal(moduleOffReason("warehouse", { wms_enabled: false, inventory_enabled: true }, { wms_enabled: false, inventory_enabled: true }), "plan");
  assert.equal(moduleOffReason("whatsapp-supervision", { whatsapp_enabled: false }, { kitchen_enabled: true }), "store");
  const page = read("app/painel/modulo-indisponivel/page.tsx");
  assert.match(page, /Object\.prototype\.hasOwnProperty\.call\(MODULE_RULES, requested\)/);
});

test("as APIs de módulo respondem 403 FEATURE_DISABLED quando o módulo está desligado", () => {
  const gate = read("lib/module-gate.ts");
  assert.match(gate, /export const FEATURE_DISABLED = "FEATURE_DISABLED"/);
  assert.match(gate, /if \(!plan\) return false;/);
  assert.match(gate, /isMenuItemEntitled\(moduleKey, mergeStoreFlags\(plan,/);
  const gated = {
    "business-continuity": "business-continuity", "capacity-management": "capacity", "central-production": "central-production",
    "change-management": "change-management", "data-governance": "data-governance", "digital-twin": "digital-twin",
    "enterprise-risk": "enterprise-risk", "geo-management": "geo-map", "integration-orchestration": "integration-orchestration",
    "network-operations": "network-operations", "reports": "reports", "revenue-management": "revenue-management",
    "security-operations": "security-operations", "service-reliability": "service-reliability", "store-opening": "store-opening",
    "warehouse-management": "warehouse",
  };
  for (const [dir, key] of Object.entries(gated)) {
    const route = read(`app/api/${dir}/route.ts`);
    assert.match(route, new RegExp(`throw new Error\\("FORBIDDEN"\\);await requireModuleEnabled\\(storeId,"${key}"\\);`), dir);
    assert.match(route, /==="FEATURE_DISABLED"\?403:500/, dir);
    assert.ok(MODULE_RULES[key], key);
  }
  // As rotas que já tinham trava própria usam o mesmo código e o mesmo status.
  for (const dir of ["customer-experience", "identity-governance", "internal-communications", "privacy"]) {
    assert.match(read(`app/api/${dir}/route.ts`), /FEATURE_DISABLED:403/, dir);
  }
});

test("mapa das APIs de módulo ainda sem trava (pendência registrada, não pode crescer)", () => {
  const known = read("docs/phase98-pilot-hardening-report.md");
  for (const dir of ["fiscal", "master-data", "incidents", "transport-management", "workforce-planning"]) {
    assert.ok(known.includes(`app/api/${dir}`), `pendência ${dir} documentada`);
  }
});
