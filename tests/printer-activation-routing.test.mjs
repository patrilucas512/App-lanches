import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("printer registrations are preserved and can only be activated or deactivated", async () => {
  const manager = await read("components/multi-printer-manager.tsx");
  assert.match(manager, /set_printer_device_active/);
  assert.match(manager, />\{device\.active\?"Desativar":"Ativar"\}</);
  assert.match(manager, /IMPRESSORA DA COZINHA/);
  assert.match(manager, /IMPRESSORA DO CAIXA/);
  assert.doesNotMatch(manager, /delete_printer_device/);
});

test("each order is routed to the active kitchen and cashier printer", async () => {
  const migration = await read("supabase/migrations/20260922233940_printer_activation_and_sector_routing.sql");
  assert.match(migration, /printer\.sector in \('kitchen','cashier'\)/);
  assert.match(migration, /distinct on \(printer\.sector\)/);
  assert.match(migration, /printer_jobs_original_ticket_device_unique/);
  assert.match(migration, /auto_print_kitchen = true/);
  assert.match(migration, /set active = true,/);
  assert.match(migration, /sector in \('kitchen','cashier'\) then true/);
});

test("kitchen panel activates the registered kitchen printer without creating another registration", async () => {
  const kitchen = await read("components/kitchen-board.tsx");
  assert.match(kitchen, /Conectar e ativar neste computador/);
  assert.match(kitchen, /set_printer_device_active/);
  assert.match(kitchen, /list_printer_devices/);
  assert.match(kitchen, /requested_active: true/);
  assert.doesNotMatch(kitchen, /register_printer_device/);
});

test("kitchen printer registration activates automatically and can reinstall the connector without duplicating it", async () => {
  const kitchen = await read("components/kitchen-board.tsx");
  const migration = await read("supabase/migrations/20260923002436_automatic_kitchen_printer_activation.sql");
  const installer = await read("public/mesa-viva-installer.ps1");
  assert.match(kitchen, /prepare_printer_device_activation/);
  assert.match(kitchen, /Ativador baixado/);
  assert.match(migration, /active=true,auto_print=true,is_default=true/);
  assert.match(migration, /requested_sector in \('kitchen','cashier'\) then true/);
  assert.match(installer, /GetFolderPath\("Startup"\)/);
  assert.match(installer, /Start-Process powershell\.exe/);
});
