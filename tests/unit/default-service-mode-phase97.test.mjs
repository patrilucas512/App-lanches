import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Found by the Phase 97 E2E: a store created by signup had no service_modes row, the public menu showed
// "Aberto agora" from its fallback and place_public_order_v2 refused every order ("Estabelecimento indisponível.").
const migration = readFileSync(new URL("../../supabase/migrations/20261104120000_phase97_default_service_mode.sql", import.meta.url), "utf8");
const menu = readFileSync(new URL("../../components/public-menu.tsx", import.meta.url), "utf8");

test("every store with settings gets a service_modes row, now and on creation", () => {
  assert.match(migration, /after insert on public\.establishment_settings/);
  assert.match(migration, /on conflict \(establishment_id\) do nothing/);
  assert.match(migration, /where not exists \(select 1 from public\.service_modes m where m\.establishment_id = s\.establishment_id\)/);
  assert.match(migration, /revoke all on function private\.ensure_default_service_mode\(\) from public, anon, authenticated/);
});

test("the default row matches what the public menu shows when the row is missing", () => {
  assert.match(menu, /store_open: true,/);
  assert.match(menu, /counter_pickup_enabled: menu\.settings\.pickup_enabled/);
  assert.match(migration, /coalesce\(new\.pickup_enabled, true\), coalesce\(new\.delivery_enabled, true\)/);
});
