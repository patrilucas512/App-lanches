import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const read = path => fs.readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("cashier team uses the complete operator action card", async () => {
  const [manager, css] = await Promise.all([
    read("components/custom-staff-manager.tsx"),
    read("app/globals.css"),
  ]);

  assert.match(manager, /Equipe do caixa/);
  assert.match(manager, /cashier-member-actions/);
  assert.match(manager, /archive_cashier_staff_member/);
  assert.match(manager, /"Editar"/);
  assert.match(manager, /"Bloquear" : "Ativar"/);
  assert.match(manager, /"Excluir"/);
  assert.match(css, /\.cashier-member-row/);
});

test("cashier sees active products before typing and can filter them", async () => {
  const [page, consoleSource, migration] = await Promise.all([
    read("app/caixa/page.tsx"),
    read("components/pos-console.tsx"),
    read("supabase/migrations/20260923221430_fix_cashier_staff_and_product_access.sql"),
  ]);

  assert.match(page, /\.eq\("active", true\)/);
  assert.match(page, /productLoadError/);
  assert.match(consoleSource, /!normalizedSearch/);
  assert.match(consoleSource, /produto.*ativo/);
  assert.match(migration, /create policy products_cashier_read/);
  assert.match(migration, /private\.is_financial_employee/);
  assert.match(migration, /financial_history_preserved/);
});
