import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const history = read("../components/delivery-pickup-history.tsx");
const custody = read("../supabase/migrations/20260825014000_phase7_custody_hardening.sql");

test("prova de retirada reutiliza eventos verificados e restringe estabelecimento", () => {
  assert.match(history, /from\("delivery_events"\)/);
  assert.match(history, /eq\("establishment_id", establishmentId\)/);
  assert.match(history, /eq\("event_type", "pickup_verified"\)/);
  assert.doesNotMatch(history, /\.(insert|update|delete|upsert)\(/);
  assert.doesNotMatch(history, /pickup_code_hash|requested_code|service_role/);
});

test("consulta limita o volume, usa ordem estável e trata erro e vazio", () => {
  assert.match(history, /range\(page \* pageSize, page \* pageSize \+ pageSize\)/);
  assert.match(history, /order\("id", \{ ascending: false \}\)/);
  assert.match(history, /gte\("occurred_at"/);
  assert.match(history, /lt\("occurred_at"/);
  assert.match(history, /role="alert"/);
  assert.match(history, /Nenhuma retirada com código validado/);
  assert.match(history, /current = false/);
});

test("registro de custódia é produzido depois de validar código e atribuição", () => {
  assert.match(custody, /driver_profile_id = driver.id and status = 'accepted'/);
  assert.match(custody, /for update/);
  assert.ok(custody.indexOf("supplied_hash <> delivery.pickup_code_hash") < custody.indexOf("'pickup_verified'"));
  assert.match(custody, /picked_up_at = now\(\), pickup_verified_by = actor/);
  assert.match(custody, /jsonb_build_object\('assignment_id',assignment.id/);
});
