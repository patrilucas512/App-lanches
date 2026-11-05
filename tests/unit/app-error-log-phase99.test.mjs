import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { redact, safePath, appErrorRow } from "../../lib/error-log.ts";

// Fase 99G. Prova do alerta no dev: scripts/dev/phase99g-errors-check.sql (5 de 5 em 05/11/2026).
test("mascara dados pessoais e segredos", () => {
  const raw = "Falha para maria.silva@gmail.com tel (11) 98765-4321 cpf 123.456.789-09 cnpj 12.345.678/0001-90 " +
    "chave sk_live_abcdefghijklmnop sb_secret_ABCDEFGH123456 Bearer eyJhbGciOiJIUzI1NiJ9.x.y token " + "a".repeat(40);
  const out = redact(raw);
  for (const leak of ["maria.silva@gmail.com", "98765-4321", "123.456.789-09", "12.345.678/0001-90", "sk_live_", "sb_secret_", "eyJhbGci", "a".repeat(40)]) {
    assert.ok(!out.includes(leak), `vazou: ${leak} -> ${out}`);
  }
  assert.match(out, /\[email\]/);
  assert.ok(redact("x".repeat(2000)).length <= 500);
});

test("rota sem query string e sem identificadores", () => {
  assert.equal(safePath("/api/orders/3f1c2d9e-1234-4abc-9def-1234567890ab?token=abc&phone=11999"), "/api/orders/:id");
  assert.equal(safePath("/conta/loja-x/pedido/1234567"), "/conta/loja-x/pedido/:id");
});

test("linha gravada usa o modelo da rota e não guarda o objeto da requisição", () => {
  const row = appErrorRow({ error: Object.assign(new Error("Falha ao salvar para joao@x.com"), { digest: "abc123" }), method: "POST",
    path: "/api/x?cpf=12345678909", routePath: "/api/fiscal/document/[token]", routeType: "route" });
  assert.equal(row.route, "/api/fiscal/document/[token]");
  assert.equal(row.message, "Falha ao salvar para [email]");
  assert.equal(row.fingerprint.length, 32);
  assert.deepEqual(Object.keys(row).sort(), ["digest", "environment", "error_name", "fingerprint", "message", "method", "release", "route", "route_type", "status"].sort());
});

test("instrumentation registra todo erro de rota sem derrubar a resposta", () => {
  const inst = readFileSync(new URL("../../instrumentation.ts", import.meta.url), "utf8");
  assert.match(inst, /export async function onRequestError\(/);
  assert.match(inst, /recordAppError\(\{ error, method: request\.method, path: request\.path, routePath: context\.routePath/);
  const lib = readFileSync(new URL("../../lib/error-log.ts", import.meta.url), "utf8");
  assert.match(lib, /catch \{\s*\/\/ o registro de erro nunca derruba a resposta/);
  assert.match(lib, /AbortSignal\.timeout\(2000\)/);
});

test("tabela só do servidor, retenção de 14 dias e alerta ligado à 98F", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20261105122000_phase99g_app_error_log.sql", import.meta.url), "utf8");
  assert.match(sql, /revoke all on public\.app_error_events from anon, authenticated;/);
  assert.match(sql, /grant insert on public\.app_error_events to service_role;/);
  assert.match(sql, /occurred_at < now\(\) - interval '14 days'/);
  assert.match(sql, /'app_errors', 10, 15, 60, 1, false/);
  assert.match(sql, /select \* from private\.pilot_alert_signals_base\(requested_now\)/);
});
