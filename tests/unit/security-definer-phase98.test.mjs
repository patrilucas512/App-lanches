import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Fase 98G. Provas no dev: scripts/dev/phase98g-public-check.sql (7 de 7) e o E2E do núcleo depois das revogações.
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const lot1 = read("supabase/migrations/20261104135000_phase98g_public_functions.sql");
const lot2 = read("supabase/migrations/20261104136000_phase98g_internal_functions.sql");
const review = read("docs/security-definer-review.md");

test("lote 1: anon perde só o que não precisa ser público", () => {
  assert.match(lot1, /revoke execute on function public\.place_public_order\(text, text, text, text, jsonb, text, text, text, text, integer\) from anon, authenticated;/);
  assert.match(lot1, /revoke execute on function public\.set_store_open\(uuid, boolean\) from anon;/);
  assert.doesNotMatch(lot1, /revoke[^;]*place_public_order_v2/);
  assert.doesNotMatch(lot1, /revoke[^;]*get_public_menu/);
});

test("lote 1: limite de frequência nas escritas públicas, fora do servidor", () => {
  assert.match(lot1, /if coalesce\(\(select auth\.role\(\)\), ''\) = 'service_role' then return true; end if;/);
  assert.match(lot1, /bucket_key text := /, "sem ambiguidade com a coluna bucket");
  assert.match(lot1, /'order_ip'[^;]*30, interval '10 minutes'\)/);
  assert.match(lot1, /'order_store'[^;]*600, interval '10 minutes'\)/);
  assert.match(lot1, /Muitos pedidos em pouco tempo/);
  for (const fn of ["place_public_order_v2", "start_web_chat_session", "record_public_event"]) assert.ok(lot1.includes(`public.${fn}(`), fn);
  assert.match(lot1, /PHASE98G_INJECT_FAILED/);
  assert.match(lot1, /revoke all on function private\.public_rate_allow\(text, text, integer, interval\) from public, anon, authenticated;/);
});

test("lote 2: cada revogação mantém o service_role", () => {
  const revokes = [...lot2.matchAll(/^revoke execute on function public\.([a-z_0-9]+)\(/gm)].map((m) => m[1]);
  const grants = [...lot2.matchAll(/^grant execute on function public\.([a-z_0-9]+)\([^;]*\) to service_role;/gm)].map((m) => m[1]);
  assert.equal(revokes.length, 19);
  assert.deepEqual(grants, revokes);
  for (const name of revokes) assert.match(review, new RegExp(`\\| \`${name}\` \\| interna[^|]*\\|[^|]*\\| \\*\\*EXECUTE revogado de authenticated\\*\\*`), name);
});

test("nenhuma função revogada é chamada com a sessão do usuário no código", () => {
  const revokes = [...lot2.matchAll(/^revoke execute on function public\.([a-z_0-9]+)\(/gm)].map((m) => m[1]);
  const files = ["app/api/logistics/route.ts", "lib/ai-attendant/order-conversation.ts", "app/api/quality/route.ts", "app/api/kitchen-orchestration/route.ts", "app/api/whatsapp/messages/route.ts", "app/api/customer-portal/[slug]/route.ts", "lib/saas-billing.ts", "app/api/onboarding/import/route.ts", "app/superadmin/growth/page.tsx", "app/superadmin/produto/page.tsx", "app/superadmin/qualidade/page.tsx", "app/api/product-analytics/route.ts"];
  for (const file of files) {
    const text = read(file);
    for (const name of revokes) {
      for (const m of text.matchAll(new RegExp(`([\\w.]+)\\.rpc\\(\\s*"${name}"`, "g"))) {
        assert.match(m[1], /(^|\.)admin$/, `${file}: ${name} chamada por ${m[1]}`);
      }
    }
  }
});

test("documento cobre as públicas e aponta as sem uso sem apagar", () => {
  assert.match(review, /## Funções executáveis por anon \(as 22\)/);
  assert.match(review, /Sem `search_path` fixo \| 0 \| 0/);
  assert.match(review, /apontada: sem chamada direta no código; revisar/);
  assert.doesNotMatch(lot1 + lot2, /drop function/i);
});
