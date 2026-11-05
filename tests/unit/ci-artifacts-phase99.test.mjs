import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// Fase 99: o error-context.md e os traces do Playwright guardam os valores digitados nos campos (inclusive senhas
// de teste). Nenhum workflow pode publicá-los como artefato.
const workflows = readdirSync(new URL("../../.github/workflows/", import.meta.url)).filter((f) => /\.ya?ml$/.test(f));

test("o E2E publica só capturas e exclui error-context.md e traces", () => {
  const yml = readFileSync(new URL("../../.github/workflows/e2e-core.yml", import.meta.url), "utf8");
  const upload = yml.slice(yml.indexOf("actions/upload-artifact"));
  assert.match(upload, /test-results\/e2e-core\/artifacts\/\*\*\/\*\.png/);
  assert.match(upload, /!test-results\/\*\*\/error-context\.md/);
  assert.match(upload, /!test-results\/\*\*\/\*\.zip/);
});

test("nenhum workflow publica a pasta inteira de resultados do Playwright", () => {
  for (const file of workflows) {
    const yml = readFileSync(new URL(`../../.github/workflows/${file}`, import.meta.url), "utf8");
    for (const m of yml.matchAll(/path:\s*\|?\s*\n?([\s\S]*?)(?:\n\s*[a-z-]+:|\n\s*-\s|$)/g)) {
      const paths = m[1].split("\n").map((s) => s.trim()).filter(Boolean);
      for (const p of paths) {
        assert.ok(!/^(test-results|playwright-report)\/?(\*\*)?\/?$/.test(p), `${file}: publica ${p} inteira`);
        assert.ok(!/error-context\.md$/.test(p) || p.startsWith("!"), `${file}: publica error-context.md`);
      }
    }
  }
});

test("o CI de E2E não liga trace (guarda senhas)", () => {
  const config = readFileSync(new URL("../../playwright.config.ts", import.meta.url), "utf8");
  assert.match(config, /trace: process\.env\.CI \? "off"/);
});
