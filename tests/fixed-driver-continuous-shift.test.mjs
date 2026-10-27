import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");

test("fixed driver keeps an active shift and receives kitchen commands automatically", async () => {
  const [page, consoleUi, migration] = await Promise.all([
    read("app/motoboy/page.tsx"),
    read("components/driver-dispatch-console.tsx"),
    read("supabase/migrations/20260915183000_fixed_driver_continuous_shift.sql"),
  ]);
  assert.match(page, /driver_kind/);
  assert.match(page, /driverKind=/);
  assert.match(consoleUi, /Turno ativo e recebendo comandas/);
  assert.match(consoleUi, /volta automaticamente para a fila/);
  assert.match(consoleUi, /void refresh\(\)/);
  assert.match(consoleUi, /refresh_fixed_driver_shift/);
  assert.match(migration, /refresh_fixed_driver_shift/);
  assert.match(migration, /expires_at = now\(\) \+ interval '60 seconds'/);
  assert.match(migration, /private\.offer_next_driver_locked/);
  assert.doesNotMatch(migration, /status = 'accepted'/);
});
