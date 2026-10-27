import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const history = read("../components/delivery-audit-history.tsx");
const manager = read("../components/delivery-dispatch-manager.tsx");
test("auditoria reutiliza eventos e logs com escopo explícito do estabelecimento", () => {
  assert.match(history, /from\("delivery_events"\)/);
  assert.match(history, /from\("audit_logs"\)/);
  assert.match(history, /eq\("establishment_id", establishmentId\)/);
  assert.match(history, /action.like.delivery.%,action.like.driver.%/);
  assert.doesNotMatch(history, /\.(insert|update|upsert|delete)\(/);
});
test("consultas de auditoria não selecionam metadados ou segredos", () => {
  const projections = [...history.matchAll(/\.select\("([^"]+)"\)/g)].map(match => match[1]);
  assert.equal(projections.length, 2);
  for (const projection of projections) {
    assert.doesNotMatch(projection, /\*|metadata|token|hash|secret|phone|latitude|longitude/);
  }
});
test("histórico é carregado sob demanda, paginado e com estados de erro", () => {
  assert.match(manager, /showAuditHistory && <DeliveryAuditHistory/);
  assert.match(history, /range\(page \* 20, page \* 20 \+ 20\)/);
  assert.match(history, /order\("id", \{ ascending: false \}\)/);
  assert.match(history, /current = false/);
  assert.match(history, /role="alert"/);
  assert.match(history, /Nenhum registro encontrado/);
});
