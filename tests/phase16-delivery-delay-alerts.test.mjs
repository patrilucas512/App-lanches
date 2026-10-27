import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../supabase/migrations/20260903235159_phase16_delivery_delay_alerts.sql");
const manager = read("../components/delivery-dispatch-manager.tsx");
const settings = read("../components/delivery-settings-manager.tsx");
const pushFunction = read("../supabase/functions/send-push-notification/index.ts");

test("Fase 16 guarda alertas ativos sem criar duplicatas", () => {
  assert.match(migration, /create table if not exists public\.delivery_operational_alerts/);
  assert.match(migration, /delivery_operational_alerts_active_unique/);
  assert.match(migration, /where resolved_at is null/);
  assert.match(migration, /on conflict \(delivery_id, alert_type\) where resolved_at is null/);
});

test("detecção cobre cozinha, espera, localização e rota", () => {
  for (const alertType of ["kitchen_delayed", "waiting_driver", "driver_location_stale", "route_delayed"]) {
    assert.match(migration, new RegExp(alertType));
  }
  assert.match(migration, /estimated_arrival_at/);
  assert.match(migration, /driver_locations/);
});

test("alertas encerram automaticamente quando a condição normaliza", () => {
  assert.match(migration, /set resolved_at = now\(\)/);
  assert.match(migration, /not exists \(/);
  assert.match(migration, /private\.current_delivery_operational_alerts/);
});

test("consulta de alertas é restrita à administração", () => {
  assert.match(migration, /private\.has_role\([\s\S]*array\['owner','manager'\]/);
  assert.match(migration, /delivery_operational_alerts_manager_read/);
  assert.match(migration, /revoke all on table public\.delivery_operational_alerts from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.refresh_delivery_operational_alerts\(uuid\) to authenticated/);
});

test("painel recebe atualização periódica e por realtime", () => {
  assert.match(manager, /refresh_delivery_operational_alerts/);
  assert.match(manager, /table: "delivery_operational_alerts"/);
  assert.match(manager, /Alertas operacionais/);
  assert.match(manager, /ATENÇÃO OPERACIONAL/);
});

test("administrador configura todos os limites de atraso", () => {
  for (const field of ["alert_kitchen_delay", "alert_waiting_driver", "alert_driver_stale", "alert_route_delay"]) {
    assert.match(settings, new RegExp(field));
  }
  assert.match(settings, /não são registros disciplinares/);
});

test("novo alerta operacional gera push deduplicado", () => {
  assert.match(migration, /delivery_delay_alert/);
  assert.match(migration, /delivery_operational_alert_push/);
  assert.match(migration, /coalesce\(alert_id/);
  assert.match(pushFunction, /delivery_delay_alert/);
  assert.match(pushFunction, /delivery_operational_alerts/);
  assert.match(pushFunction, /masterapp-delay-/);
});
