import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { API_MODULE_DIRS, API_OWN_CHECK_DIRS, API_UNFLAGGED_DIRS, API_EXEMPT_PATH } from "../../lib/api-module-map.ts";
import { MODULE_RULES } from "../../lib/menu-entitlements.ts";

// Fase 99A: varre TODAS as rotas de app/api. Nenhuma API de módulo nova escapa da trava.
const root = fileURLToPath(new URL("../../", import.meta.url));
const apiDir = join(root, "app/api");
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const routes = (dir) => walk(join(apiDir, dir)).filter((p) => p.endsWith("route.ts")).map((p) => p.slice(root.length).replaceAll("\\", "/"));
const topDirs = readdirSync(apiDir).filter((n) => statSync(join(apiDir, n)).isDirectory());
const GATE = /requireModuleEnabled\(|requireOrganizationModuleEnabled\(|storeModuleEnabled(BySlug)?\(/;

test("toda pasta de app/api está classificada uma única vez", () => {
  const all = [...Object.keys(API_MODULE_DIRS), ...API_OWN_CHECK_DIRS, ...Object.keys(API_UNFLAGGED_DIRS)];
  assert.equal(new Set(all).size, all.length, "pasta em mais de uma lista");
  const missing = topDirs.filter((d) => !all.includes(d));
  assert.deepEqual(missing, [], "pastas novas precisam entrar em lib/api-module-map.ts");
  const gone = all.filter((d) => !topDirs.includes(d));
  assert.deepEqual(gone, [], "pastas removidas continuam listadas");
});

test("todas as rotas de módulo conferem a flag (fora workers e webhooks)", () => {
  const ungated = [];
  let checked = 0;
  for (const [dir, key] of Object.entries(API_MODULE_DIRS)) {
    assert.ok(MODULE_RULES[key], `${dir}: chave ${key} não existe em MODULE_RULES`);
    for (const file of routes(dir)) {
      if (API_EXEMPT_PATH.test(file)) continue;
      checked++;
      const source = readFileSync(join(root, file), "utf8");
      if (!GATE.test(source)) ungated.push(file);
      else assert.ok(source.includes(`"${key}"`), `${file}: trava com outra chave que não ${key}`);
    }
  }
  assert.deepEqual(ungated, []);
  assert.ok(checked >= 50, `rotas conferidas: ${checked}`);
});

test("rotas que tratam erro pela mensagem devolvem 403 para FEATURE_DISABLED", () => {
  for (const dir of Object.keys(API_MODULE_DIRS)) {
    for (const file of routes(dir)) {
      if (API_EXEMPT_PATH.test(file)) continue;
      const source = readFileSync(join(root, file), "utf8");
      if (!/requireModuleEnabled\(|requireOrganizationModuleEnabled\(/.test(source)) continue;
      // nenhum catch pode mapear FORBIDDEN para 403 e deixar o resto (inclusive FEATURE_DISABLED) cair em 500
      assert.doesNotMatch(source, /===\s*["']FORBIDDEN["']\s*\?\s*403\s*:\s*500/, file);
    }
  }
});

test("as rotas com checagem própria continuam lendo flags", () => {
  for (const dir of API_OWN_CHECK_DIRS) {
    const text = routes(dir).map((f) => readFileSync(join(root, f), "utf8")).join("\n");
    assert.match(text, /_enabled|FEATURE_DISABLED/, dir);
  }
});
