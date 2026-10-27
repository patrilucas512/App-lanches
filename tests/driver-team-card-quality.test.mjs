import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("motoboy team card follows the same readable action-card pattern", async () => {
  const [manager, css] = await Promise.all([
    fs.readFile("components/custom-staff-manager.tsx", "utf8"),
    fs.readFile("app/globals.css", "utf8"),
  ]);

  assert.match(manager, /driver-member-row/);
  assert.match(manager, /driver-member-actions/);
  assert.match(manager, /"Editar"/);
  assert.match(manager, /Vínculo:/);
  assert.match(css, /\.driver-member-actions/);
  assert.match(css, /grid-template-columns:repeat\(3/);
  assert.match(css, /grid-template-columns:repeat\(2/);
});
