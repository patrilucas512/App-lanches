import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Correções encontradas no teste de ponta a ponta de uma loja nova, antes do piloto.
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/20261113150000_pre_pilot_fixes.sql");

test("loja nova recebe link sem acento e longe de nomes reservados e links antigos", () => {
  assert.match(sql, /base_slug:=public\.normalize_menu_slug\(/);
  assert.match(sql, /exists\(select 1 from public\.establishment_slug_history where slug=final_slug\)/);
  assert.match(sql, /''demo''/);
  assert.match(sql, /raise exception 'PRE_PILOT_CREATE_ESTABLISHMENT_CHANGED/);
});

test("escolhas do cadastro chegam ao atendimento que o cardápio lê", () => {
  assert.match(sql, /perform public\.apply_onboarding_service_mode\(target_establishment\)/);
  assert.match(sql, /delivery_enabled = delivery/);
  assert.match(sql, /counter_pickup_enabled = pickup/);
  assert.match(sql, /when 'credit_on_delivery' then 'credit_card' when 'debit_on_delivery' then 'debit_card'/);
  assert.match(sql, /m\.role = 'owner'/);
});

test("pedido numerado por loja", () => {
  assert.match(sql, /alter table public\.orders alter column order_number drop identity if exists/);
  assert.match(sql, /before insert on public\.orders/);
  assert.match(sql, /on conflict \(establishment_id\) do update set last_number = c\.last_number \+ 1/);
});

test("chave Pix só para quem tem o código de um pedido em Pix", () => {
  assert.match(sql, /where o\.tracking_token = requested_tracking_token\s+and o\.payment_method = 'pix'/);
  assert.match(read("components/public-menu.tsx"), /tracking\.payment_method === "pix"[^\n]*<ManualPixKey/);
});

test("cartão de crédito na entrega não aparece como débito", () => {
  const menu = read("components/public-menu.tsx");
  assert.match(menu, /value === "credit_card" \|\| value === "credit_on_delivery" \? "Cartão de crédito na entrega"/);
});

test("cozinha carrega só as comandas que mostra, sem ler o histórico inteiro", () => {
  const data = read("lib/kitchen-board-data.ts");
  assert.match(data, /\.or\(`status\.neq\.delivered,delivered_at\.gte\.\$\{deliveredSince\}`\)/);
  assert.match(data, /\.limit\(TICKET_LIMIT\)/);
  assert.match(data, /from\("order_items"\)[^\n]*\.in\("order_id", chunk\)/);
  for (const file of ["app/cozinha/page.tsx", "components/kitchen-board.tsx"]) {
    const source = read(file);
    assert.match(source, /loadKitchenBoardData\(supabase, /);
    assert.doesNotMatch(source, /from\("order_items"\)/);
  }
});

test("cadastro interrompido volta ao formulário e conclui sem recriar a loja", () => {
  assert.match(read("app/onboarding/page.tsx"), /if \(membership && !pendingSetup\)/);
  assert.match(read("components/onboarding-form.tsx"), /!\/already exists\/i\.test\(createError\.message\)/);
  assert.match(read("app/login/page.tsx"), /params\.erro === "confirmacao"/);
});
