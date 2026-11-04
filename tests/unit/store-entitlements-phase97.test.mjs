import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mergeStoreFlags } from "../../lib/store-entitlements.ts";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("a module is on when the store or the plan turns it on", () => {
  const merged = mergeStoreFlags({ id: "plan", wms_enabled: true, split_bill_enabled: false, reports_enabled: false }, { establishment_id: "s", wms_enabled: false, split_bill_enabled: true, delivery_enabled: false, whatsapp_enabled: true });
  assert.equal(merged.wms_enabled, true);
  assert.equal(merged.split_bill_enabled, true);
  assert.equal(merged.reports_enabled, false);
  // Flags that only exist on the store come from the store, including "off".
  assert.equal(merged.delivery_enabled, false);
  assert.equal(merged.whatsapp_enabled, true);
  assert.equal(merged.establishment_id, undefined);
  assert.equal(merged.id, "plan");
});

test("without a store row the plan is unchanged", () => {
  const plan = { kitchen_enabled: true };
  assert.equal(mergeStoreFlags(plan, null), plan);
});

test("the dashboard reads the store flags and the menu hides core links of modules that are off", () => {
  assert.match(read("lib/dashboard.ts"), /from\("store_feature_flags"\)[\s\S]*mergeStoreFlags/);
  const shell = read("components/dashboard-shell.tsx");
  // Fase 98B: as regras saíram do componente para lib/menu-entitlements.ts.
  const rules = read("lib/menu-entitlements.ts");
  assert.match(shell, /isMenuItemEntitled\(link\.key, plan/);
  assert.match(rules, /"deliveries": \{ label: "Entregas", flags: \["drivers_enabled", "delivery_enabled"\] \}/);
  assert.match(rules, /"ai-attendant": \{ label: "Atendente IA", flags: \["ai_enabled"\] \}/);
  assert.match(rules, /"whatsapp-supervision": \{ label: "Supervisão", flags: \["whatsapp_enabled"\] \}/);
  // Attendants used to get their list with no check at all (Voz showed with voice off).
  assert.match(shell, /role === "attendant" \? attendantLinks\.filter\(isEntitled\)/);
});
