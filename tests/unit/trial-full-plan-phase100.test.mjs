import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isBillingBlocked } from "../../lib/plan-reading.ts";

// Teste grátis: 15 dias no plano mais completo; vencido, o painel fecha até escolher um plano.
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const now = new Date("2026-11-20T12:00:00Z");
const publicPlan = { is_public: true };

test("teste vencido em plano público bloqueia o painel", () => {
  assert.equal(isBillingBlocked({ status: "trialing", trial_ends_at: "2026-11-20T11:59:00Z" }, publicPlan, now), true);
  assert.equal(isBillingBlocked({ status: "expired", trial_ends_at: null }, publicPlan, now), true);
});

test("teste em andamento, assinatura paga ou plano interno não bloqueiam", () => {
  assert.equal(isBillingBlocked({ status: "trialing", trial_ends_at: "2026-11-21T00:00:00Z" }, publicPlan, now), false);
  assert.equal(isBillingBlocked({ status: "active", trial_ends_at: null }, publicPlan, now), false);
  assert.equal(isBillingBlocked({ status: "past_due", trial_ends_at: null }, publicPlan, now), false);
  assert.equal(isBillingBlocked({ status: "trialing", trial_ends_at: "2026-08-07T00:00:00Z" }, { is_public: false }, now), false);
  assert.equal(isBillingBlocked(null, publicPlan, now), false);
});

test("painel manda a loja bloqueada para a escolha de plano", () => {
  const dashboard = read("lib/dashboard.ts");
  assert.match(dashboard, /subscriptions\(status,trial_ends_at,plans\(\*\)\)/);
  assert.match(dashboard, /if \(billingBlocked && !options\.allowBlocked\) redirect\("\/painel\/escolher-plano"\)/);
  const page = read("app/painel/escolher-plano/page.tsx");
  assert.match(page, /getDashboardContext\(\{ allowBlocked: true \}\)/);
  assert.match(page, /Escolha o plano que vai/);
  assert.match(page, /\.eq\("is_public", true\)/);
});

test("cadastro usa o plano mais caro por 15 dias e vence os testes de hora em hora", () => {
  const sql = read("supabase/migrations/20261111130000_trial_full_plan_15_days.sql");
  assert.match(sql, /order by monthly_price_cents desc,sort_order,created_at/);
  assert.match(sql, /now\(\)\+interval ''15 days''/);
  assert.match(sql, /set status = 'expired'[\s\S]*p\.is_public[\s\S]*s\.trial_ends_at <= now\(\)/);
  assert.match(sql, /revoke all on function private\.expire_due_trials\(\) from public, anon, authenticated/);
  assert.match(sql, /cron\.schedule\('masterapp-expire-due-trials'/);
  assert.match(read("app/cadastro/page.tsx"), /15 DIAS GRÁTIS/);
});
