import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { asList, firstOf, livePlan, livePlanOfStores } from "../../lib/plan-reading.ts";

// Fase 99B: o PostgREST devolve `subscriptions` (establishment_id único) e `plans` (muitos-para-um) como objeto.
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const basic = { name: "Básico", public_api_enabled: false };

test("aceita objeto e lista", () => {
  assert.deepEqual(asList(null), []);
  assert.deepEqual(asList(basic), [basic]);
  assert.equal(firstOf([basic]), basic);
  assert.equal(firstOf(basic), basic);
  assert.equal(firstOf([]), null);
});

test("plano vigente só de assinatura ativa, em teste ou em atraso", () => {
  assert.equal(livePlan({ status: "trialing", plans: basic }), basic);
  assert.equal(livePlan([{ status: "canceled", plans: basic }]), null);
  assert.equal(livePlanOfStores([{ subscriptions: { status: "active", plans: [basic] } }]), basic);
  assert.equal(livePlanOfStores([{ subscriptions: null }, { subscriptions: { status: "past_due", plans: basic } }]), basic);
});

test("o formato antigo deixava o plano nulo (por isso as APIs não restringiam nada)", () => {
  const store = { subscriptions: { status: "active", plans: basic } };
  // como o código antigo lia
  const oldWay = (store.subscriptions?.[0])?.plans?.[0] ?? null;
  assert.equal(oldWay, null);
  assert.equal(livePlanOfStores([store]), basic);
});

test("nenhum ponto corrigido volta ao padrão quebrado", () => {
  for (const file of ["app/api/integrations/manage/route.ts", "app/api/marketplace/manage/route.ts", "app/api/oauth/authorize/route.ts",
    "app/assinar/resultado/page.tsx", "app/superadmin/pagamentos/page.tsx", "app/superadmin/estabelecimentos/page.tsx",
    "app/superadmin/estabelecimentos/[id]/page.tsx", "app/superadmin/relatorios/exportar/route.ts", "lib/dashboard.ts"]) {
    const s = read(file);
    assert.doesNotMatch(s, /subscriptions\?\.\[0\]|plans\?\.length|plans\?\.\[0\]|subscription\.plans\[0\]/, file);
  }
  assert.match(read("app/api/integrations/manage/route.ts"), /return livePlanOfStores\(data\);/);
  assert.match(read("app/api/marketplace/manage/route.ts"), /return livePlanOfStores\(data\)/);
  assert.match(read("app/api/oauth/authorize/route.ts"), /const plan=livePlanOfStores\(stores\)/);
});
