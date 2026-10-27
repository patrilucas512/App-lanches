import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("keeps the useful delivery fields without removing current payment flow", async () => {
  const menu = await readFile(new URL("../components/public-menu.tsx", import.meta.url), "utf8");
  for (const field of [
    "delivery_street", "delivery_number", "delivery_complement",
    "delivery_neighborhood", "delivery_reference",
  ]) assert.match(menu, new RegExp(`name=\\"${field}\\"`));
  for (const field of ["delivery_postal_code", "delivery_city", "delivery_state"])
    assert.doesNotMatch(menu, new RegExp(`name=\\"${field}\\"`));
  assert.match(menu, /NOME E SOBRENOME/);
  assert.match(menu, /FORMA DE PAGAMENTO/);
  assert.match(menu, /Calcular taxa de entrega/);
  assert.doesNotMatch(menu, /name="delivery_address"/);
});
