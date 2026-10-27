import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../supabase/migrations/20260903225631_phase15_delivery_eta.sql");
const publicMenu = read("../components/public-menu.tsx");
const deliveryManager = read("../components/delivery-dispatch-manager.tsx");
const deliverySettings = read("../components/delivery-settings-manager.tsx");

test("Fase 15 armazena uma faixa de previsão auditável por entrega", () => {
  assert.match(migration, /estimated_min_minutes integer/);
  assert.match(migration, /estimated_max_minutes integer/);
  assert.match(migration, /estimated_arrival_at timestamptz/);
  assert.match(migration, /eta_factors jsonb/);
  assert.match(migration, /deliveries_eta_range_check/);
});

test("estimativa combina cozinha, motoboys, distância e histórico", () => {
  const calculator = migration.slice(migration.indexOf("create or replace function private.calculate_delivery_eta"));
  assert.match(calculator, /kitchen_queue/);
  assert.match(calculator, /available_drivers/);
  assert.match(calculator, /configured_distance/);
  assert.match(calculator, /historical_deliveries/);
  assert.match(calculator, /greatest\(configured_total, operational_total\)/);
});

test("cotação pública mantém compatibilidade e devolve faixa mínima e máxima", () => {
  const quote = migration.slice(migration.indexOf("create or replace function public.quote_public_delivery"));
  assert.match(quote, /'estimated_minutes'/);
  assert.match(quote, /'estimated_min_minutes'/);
  assert.match(quote, /'estimated_max_minutes'/);
  assert.match(quote, /grant execute on function public.quote_public_delivery\(text,text,integer\) to anon, authenticated/);
});

test("previsão é recalculada quando o destino e o bairro são vinculados", () => {
  assert.match(migration, /delivery_destinations_refresh_eta/);
  assert.match(migration, /after insert or update of delivery_zone_id/);
  assert.match(migration, /private.refresh_delivery_eta_from_destination/);
});

test("cliente visualiza a faixa no checkout e no acompanhamento", () => {
  assert.match(publicMenu, /Previsão: <b>\{deliveryQuote\.estimated_min_minutes/);
  assert.match(publicMenu, /tracking-delivery-eta/);
  assert.match(publicMenu, /estimativa operacional/);
});

test("admin visualiza a mesma previsão prometida ao cliente", () => {
  assert.match(deliveryManager, /estimated_min_minutes,estimated_max_minutes,estimated_arrival_at/);
  assert.match(deliveryManager, /PREVISÃO AO CLIENTE/);
  assert.match(deliveryManager, /Limite estimado/);
});

test("admin pode informar distância aproximada sem perder zonas existentes", () => {
  assert.match(migration, /add column if not exists distance_km/);
  assert.match(deliverySettings, /DISTÂNCIA APROXIMADA \(KM\)/);
  assert.match(deliverySettings, /distance_km/);
});

test("funções internas não ficam executáveis pelas funções públicas", () => {
  assert.match(migration, /revoke all on function private.calculate_delivery_eta\(uuid,uuid,uuid\) from public, anon, authenticated/);
  assert.match(migration, /revoke all on function private.assign_delivery_eta\(\) from public, anon, authenticated/);
  assert.match(migration, /revoke all on function private.refresh_delivery_eta_from_destination\(\) from public, anon, authenticated/);
});
