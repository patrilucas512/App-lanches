import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../supabase/migrations/20260825033238_phase14_operational_grouped_dispatch.sql");
const manager = read("../components/delivery-dispatch-manager.tsx");
const driver = read("../components/driver-dispatch-console.tsx");

test("Fase 14 vincula a chamada ao agrupamento aprovado", () => {
  assert.match(migration, /add column group_suggestion_id uuid references public\.delivery_group_suggestions/);
  assert.match(migration, /private\.offer_next_delivery_group_locked/);
  assert.match(migration, /previous\.status in \('rejected','expired','canceled'\)/);
});

test("despacho agrupado bloqueia e inicia as duas entregas na mesma transação", () => {
  const start = migration.slice(migration.indexOf("create or replace function public.start_delivery_group_dispatch"));
  assert.match(start, /where id = requested_suggestion_id for update/);
  assert.match(start, /where id in \(first_delivery\.id, second_delivery\.id\)/);
  assert.match(start, /private\.offer_next_delivery_group_locked\(suggestion\.id, actor\)/);
});

test("aceite do motoboy cria duas atribuições aceitas de forma atômica", () => {
  const accept = migration.slice(migration.indexOf("create or replace function public.accept_delivery_assignment"));
  assert.match(accept, /insert into public\.delivery_assignments\([\s\S]+paired_delivery\.id/);
  assert.match(accept, /active_delivery_count = active_delivery_count \+ 2/);
  assert.match(accept, /where id in \(delivery\.id, paired_delivery\.id\)/);
  assert.match(accept, /delivery\.group_assignment_accepted/);
});

test("recusa e expiração avançam a fila do agrupamento sem voltar ao despacho individual", () => {
  assert.match(migration, /else private\.offer_next_delivery_group_locked\(assignment\.group_suggestion_id, actor\) end/g);
  assert.match(migration, /driver_group_offer_rejected/);
  assert.match(migration, /driver_group_offer_expired/);
});

test("painel administrativo inicia lote e impede despacho individual duplicado", () => {
  assert.match(manager, /start_delivery_group_dispatch/);
  assert.match(manager, /Despachar os 2 pedidos/);
  assert.match(manager, /!approvedGroup/);
  assert.match(manager, /Chamada dupla aguardando resposta/);
});

test("motoboy vê os dois pedidos e pode alternar entre as paradas", () => {
  assert.match(driver, /NOVA ROTA AGRUPADA/);
  assert.match(driver, /Aceitar as 2 entregas/);
  assert.match(driver, /driver-group-tabs/);
  assert.match(driver, /Parada \{index \+ 1\}/);
});

test("RPCs privilegiadas exigem autenticação e removem acesso público", () => {
  assert.match(migration, /actor uuid := auth\.uid\(\)/g);
  assert.match(migration, /private\.has_role\(suggestion\.establishment_id/);
  assert.match(migration, /revoke all on function private\.offer_next_delivery_group_locked\(uuid,uuid\) from public, anon, authenticated/);
  assert.match(migration, /revoke all on function public\.start_delivery_group_dispatch\(uuid\) from public, anon/);
  assert.match(migration, /grant execute on function public\.start_delivery_group_dispatch\(uuid\) to authenticated/);
});
