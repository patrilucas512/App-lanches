import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("MasterApp can be installed by customers and staff", async () => {
  const [manifestText, layout, installer, menu, worker, launcher] = await Promise.all([
    fs.readFile("public/manifest.webmanifest", "utf8"),
    fs.readFile("app/layout.tsx", "utf8"),
    fs.readFile("components/app-install-prompt.tsx", "utf8"),
    fs.readFile("components/public-menu.tsx", "utf8"),
    fs.readFile("public/push-sw.js", "utf8"),
    fs.readFile("app/abrir-app/page.tsx", "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);

  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/abrir-app");
  assert.match(layout, /manifest\.webmanifest/);
  assert.match(layout, /serviceWorker\.register/);
  assert.match(installer, /StaffInstallPrompt/);
  assert.match(installer, /CustomerInstallCard/);
  assert.match(installer, /\/motoboy/);
  assert.match(installer, /\/cozinha/);
  assert.match(installer, /\/caixa/);
  assert.match(installer, /\/garcom\/app/);
  assert.match(menu, /<CustomerInstallCard/);
  assert.match(worker, /skipWaiting/);
  assert.match(worker, /clients\.claim/);
  assert.match(launcher, /masterapp_install_destination/);
});
