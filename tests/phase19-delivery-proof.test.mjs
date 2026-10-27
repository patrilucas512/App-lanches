import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const compiled = ts.transpileModule(read("../lib/delivery-proof.ts"), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { deliveryProofLabel, hasDeliveryCoordinates } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const history = read("../components/delivery-completion-history.tsx");

test("comprovação de PIN exige método e validação, sem presumir registros antigos", () => {
  assert.equal(deliveryProofLabel("pin", true), "PIN validado");
  for (const [method, verified] of [["pin", false], [null, false], ["unknown", true], ["admin_exception", true]]) {
    assert.equal(deliveryProofLabel(method, verified), "Confirmação incompleta · conferir registro");
  }
  assert.match(deliveryProofLabel("legacy", false), /sem prova de PIN/);
  assert.match(deliveryProofLabel("admin_exception", false), /sem PIN/);
});

test("GPS preserva coordenada zero e rejeita ausências e valores inválidos", () => {
  assert.equal(hasDeliveryCoordinates(0, 0), true);
  assert.equal(hasDeliveryCoordinates(-22.9, -43.2), true);
  for (const pair of [[null, 0], [0, null], [NaN, 0], [0, Infinity], [91, 0], [0, -181]]) {
    assert.equal(hasDeliveryCoordinates(...pair), false);
  }
});

test("consulta usa a prova persistida, escopo do estabelecimento e paginação", () => {
  assert.match(history, /eq\("establishment_id", establishmentId\)/);
  assert.match(history, /eq\("status", "delivered"\)/);
  assert.match(history, /driver_profiles!deliveries_delivered_driver_tenant_fk/);
  assert.match(history, /range\(page \* pageSize, page \* pageSize \+ pageSize\)/);
  assert.match(history, /delivery_completion_reason/);
  assert.doesNotMatch(history, /delivery_pin_hash|tracking_token|service_role|\.insert\(|\.update\(|\.delete\(/);
});
