import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("every operational staff area can resend permanent access without forcing a password change", async () => {
  const [shared, waiters, kitchen, custom] = await Promise.all([
    fs.readFile("components/staff-access-actions.tsx", "utf8"),
    fs.readFile("components/attendance-manager.tsx", "utf8"),
    fs.readFile("components/kitchen-access.tsx", "utf8"),
    fs.readFile("components/custom-staff-manager.tsx", "utf8"),
  ]);

  assert.match(shared, /Enviar acesso/);
  assert.match(shared, /Redefinir senha/);
  assert.match(shared, /Instalar app/);
  assert.match(shared, /acesso permanente/i);
  assert.match(waiters, /loginPath="\/garcom\/login"/);
  assert.match(kitchen, /loginPath="\/cozinha\/login"/);
  assert.match(custom, /loginPath="\/motoboy\/login"/);
  assert.match(custom, /loginPath="\/caixa\/login"/);
  assert.match(waiters, /StaffAccessActions/);
  assert.match(kitchen, /StaffAccessActions/);
  assert.match(custom, /StaffAccessActions/);
});
