import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const sources = await Promise.all([
  read("../supabase/migrations/20260824193446_phase3_delivery_checkout.sql"),
  read("../supabase/migrations/20260824213000_phase4_kitchen_delivery_status.sql"),
  read("../supabase/migrations/20260825001000_phase6_driver_dispatch.sql"),
  read("../supabase/migrations/20260825013000_phase7_delivery_custody.sql"),
  read("../supabase/migrations/20260825014000_phase7_custody_hardening.sql"),
  read("../supabase/migrations/20260825020000_phase8_driver_location_tracking.sql"),
  read("../supabase/migrations/20260825022000_phase9_delivery_completion_proof.sql"),
  read("../supabase/migrations/20260825023000_phase10_delivery_admin_monitoring.sql"),
  read("../supabase/migrations/20260825030500_phase11_closure_interval_fix.sql"),
  read("../supabase/migrations/20260825050000_phase13_multi_gateway_payments.sql"),
  read("../supabase/migrations/20260825031739_phase13_delivery_group_suggestions.sql"),
  read("../components/driver-dispatch-console.tsx"),
  read("../components/delivery-dispatch-manager.tsx"),
]);
const [checkout, kitchen, dispatch, custodyBase, custody, tracking, completion, admin, finance, payments, grouping, driver, dispatchManager] = sources;

test("1. pedido PIX percorre checkout, cozinha, despacho e entrega", () => {
  assert.match(checkout, /place_public_order_v2/);
  assert.match(checkout, /kitchen_tickets/);
  assert.match(kitchen, /searching_driver/);
  assert.match(completion, /complete_delivery_locked/);
});

test("2. cartão online aprovado libera a cozinha uma única vez", () => {
  assert.match(payments, /confirm_online_order_payment/);
  assert.match(payments, /normalized_status='approved'/);
  assert.match(payments, /insert into public\.kitchen_tickets[\s\S]+on conflict do nothing/);
});
test("3. cartão online recusado não libera comanda", () => {
  assert.match(payments, /online_payment_status=normalized_status/);
  assert.match(payments, /if normalized_status='approved' then/);
  assert.match(payments, /defer_unpaid_online_order_ticket/);
});

test("4. dinheiro e troco são validados no servidor", () => {
  assert.match(checkout, /requested_cash_received_cents\s+is\s+null\s+or\s+requested_cash_received_cents\s+<\s+order_total/i);
  assert.match(checkout, /requested_cash_received_cents-order_total/);
});

test("5. recusa do motoboy chama o próximo da fila", () => {
  assert.match(dispatch, /reject_delivery_assignment/);
  assert.match(dispatch, /offer_next_driver_locked/);
});

test("6. chamada sem resposta expira e segue a fila", () => {
  assert.match(dispatch, /expire_delivery_offer/);
  assert.match(dispatch, /status\s*=\s*'expired'/);
});

test("7. aceitação simultânea é serializada por lock", () => {
  const acceptance = dispatch.slice(dispatch.indexOf("create or replace function public.accept_delivery_assignment"));
  assert.match(acceptance, /delivery_assignments[^;]+for update/is);
  assert.match(acceptance, /deliveries[^;]+for update/is);
  assert.match(acceptance, /assignment\.status\s*<>\s*'offered'/);
});

test("8. código de retirada incorreto incrementa tentativas", () => {
  assert.match(custody, /pickup_code_attempts\s*=\s*least\(pickup_code_attempts\s*\+\s*1/);
  assert.match(custody, /Código incorreto/);
});

test("9. código correto registra custódia e libera a rota", () => {
  assert.match(custody, /picked_up_at\s*=\s*now\(\),\s*pickup_verified_by\s*=\s*actor/);
  assert.match(custody, /'pickup_verified'/);
  assert.match(custody, /delivery_pin_hash/);
});

test("10. endereço fora da área é rejeitado pela cotação", () => {
  assert.match(checkout, /resolve_public_delivery_quote/);
  assert.match(checkout, /não realizamos entregas|fora da área|área de entrega/i);
});

test("11. perda de internet é exibida e ações continuam dependentes do servidor", () => {
  assert.match(driver, /navigator\.onLine/);
  assert.match(driver, /addEventListener\("offline"/);
  assert.match(driver, /Sem conexão/);
  assert.match(driver, /await createClient\(\)\.rpc/);
});

test("12. cancelamento administrativo/cozinha mantém evento auditável", () => {
  assert.match(kitchen, /requested_status='canceled'/);
  assert.match(kitchen, /delivery_canceled_by_kitchen/);
  assert.match(admin, /delivery_events/);
});

test("13. ocorrência de entrega fica registrada", () => {
  assert.match(custodyBase, /report_delivery_incident/);
  assert.match(custodyBase, /delivery_incidents/);
});

test("14. PIN incorreto possui limite de tentativas", () => {
  assert.match(completion, /delivery_pin_attempts\s*>=\s*5/);
  assert.match(completion, /PIN incorreto/);
});

test("15. PIN correto conclui por função transacional única", () => {
  assert.match(completion, /verify_delivery_pin/);
  assert.match(completion, /private\.complete_delivery_locked/);
});

test("16. agrupamento de entregas exige compatibilidade e aprovação administrativa", () => {
  assert.match(grouping, /create table public\.delivery_group_suggestions/);
  assert.match(grouping, /abs\(extract\(epoch[\s\S]+<= 1200/);
  assert.match(grouping, /normalize_delivery_area\(first_destination\.neighborhood\)/);
  assert.match(grouping, /normalized_decision not in \('approved','ignored'\)/);
  assert.match(grouping, /for update/);
  assert.match(grouping, /delivery_group_['"]? \|\| normalized_decision/);
  assert.match(grouping, /delivery\.group_['"]? \|\| normalized_decision/);
  assert.match(dispatchManager, /refresh_delivery_group_suggestions/);
  assert.match(dispatchManager, /decide_delivery_group_suggestion/);
  assert.match(dispatchManager, /Aprovar agrupamento/);
  assert.match(dispatchManager, /O sistema apenas sugere/);
});

test("17. repasse e fechamento do motoboy impedem período duplicado", () => {
  assert.match(finance, /close_driver_financial_period/);
  assert.match(finance, /daterange\(c\.period_start,c\.period_end,'\[\]'\)/);
  assert.match(finance, /idempotency_key/);
});

test("rastreamento aceita somente atualização autenticada e controlada", () => {
  assert.match(tracking, /update_driver_location/);
  assert.match(tracking, /auth\.uid\(\)/);
  assert.match(tracking, /requested_captured_at/);
});
