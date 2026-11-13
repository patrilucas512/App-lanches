import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (name) => readFile(new URL("../" + name, import.meta.url), "utf8");

test("delivery receipt loads and prints the complete protected destination", async () => {
  const [page, kitchen, loader, migration] = await Promise.all([
    read("app/cozinha/page.tsx"),
    read("components/kitchen-board.tsx"),
    read("lib/kitchen-board-data.ts"),
    read("supabase/migrations/20260922221253_allow_kitchen_receipt_delivery_address.sql"),
  ]);

  // The page and the live refresh both load the board through lib/kitchen-board-data.ts.
  for (const source of [page, kitchen]) assert.match(source, /loadKitchenBoardData\(supabase, /);
  assert.match(loader, /delivery_destinations/);
  for (const source of [loader, kitchen]) {
    assert.match(source, /street_number/);
    assert.match(source, /postal_code/);
    assert.match(source, /reference/);
  }
  assert.match(kitchen, /ENDERECO DE ENTREGA/);
  assert.match(kitchen, /ENDEREÇO DE ENTREGA/);
  assert.match(kitchen, /CONTATO:/);
  assert.match(migration, /array\['owner','manager','kitchen'\]::public\.member_role\[\]/);
  assert.doesNotMatch(migration, /\banon\b/);
});
