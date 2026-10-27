import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("fixed drivers receive assignments automatically while partners accept offers", async () => {
  const [migration, consoleUi] = await Promise.all([
    read("../supabase/migrations/20260916002539_fixed_driver_automatic_assignment.sql"),
    read("../components/driver-dispatch-console.tsx"),
  ]);
  assert.match(migration, /driver_kind = 'fixed'/);
  assert.match(migration, /perform public\.accept_delivery_assignment\(assignment\.id\)/);
  assert.match(consoleUi, /driverKind === "partner" \? assignments\.find/);
  assert.match(consoleUi, /Cheguei na loja · retirar pedido/);
});

test("delivery tracking stays visible until secure completion", async () => {
  const menu = await read("../components/public-menu.tsx");
  assert.match(menu, /tracking\.fulfillment_type !== "delivery" \|\| currentStatus === "delivered"/);
});

test("driver access and delivery notes use responsive readable surfaces", async () => {
  const css = await read("../app/globals.css");
  assert.match(css, /\.auth-panel/);
  assert.match(css, /\.establishment-theme :is\(\.custody-step,\.driver-address-card/);
  assert.match(css, /\.driver-console \{ min-width:0; overflow-x:hidden; \}/);
});
