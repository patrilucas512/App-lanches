import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL("../supabase/migrations/20260923004956_sync_completed_orders_to_kitchen.sql", import.meta.url),
  "utf8",
);
const waiter = await readFile(new URL("../components/waiter-order-tracker.tsx", import.meta.url), "utf8");
const menu = await readFile(new URL("../components/public-menu.tsx", import.meta.url), "utf8");

test("motoboy concluído move a comanda pronta para Entregues", () => {
  assert.match(migration, /after update of status on public\.orders/i);
  assert.match(migration, /delivery\.status = 'delivered'/i);
  assert.match(migration, /update public\.kitchen_tickets[\s\S]*status = 'delivered'/i);
  assert.match(migration, /where public_order_id = new\.id[\s\S]*status = 'ready'/i);
});

test("entrega ainda em rota não é encerrada pela cozinha", () => {
  assert.match(migration, /if completed_at is null then[\s\S]*return new/i);
});

test("retirada do garçom permanece ligada à coluna Entregues", () => {
  assert.match(waiter, /requested_status: "delivered"/);
  assert.match(migration, /after update of kitchen_status on public\.table_orders/i);
  assert.match(migration, /Retirado pelo garçom/);
});

test("confirmação do cliente conclui a retirada", () => {
  assert.match(menu, /confirm_public_order_received/);
  assert.match(menu, /kitchen_status: "delivered"/);
  assert.match(migration, /orders\.status = 'completed'/i);
});

test("migração recupera entregas antigas presas em Prontos", () => {
  assert.match(migration, /where orders\.status = 'completed'/i);
  assert.match(migration, /ticket\.status = 'ready'/i);
});
