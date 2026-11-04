import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

// Fase 98D. Prova com as contas reais do dev: tests/e2e-core/staff.spec.ts (login de garçom, cozinha, caixa e
// entregador pelo nome e senha, desktop e celular).
test("login por nome monta o e-mail com o mesmo telefone normalizado da ativação", () => {
  const sql = read("supabase/migrations/20261104134000_phase98d_employee_login_phone.sql");
  // regra das funções activate-*-access: 10 ou 11 dígitos ganham o 55
  for (const kind of ["waiter", "kitchen", "cashier", "driver"]) {
    const fn = read(`supabase/functions/activate-${kind}-access/index.ts`);
    assert.match(fn, /digits\.length === 10 \|\| digits\.length === 11\) return `55\$\{digits\}`/, kind);
  }
  assert.match(sql, /when p\.raw ~ '\^\\d\{10,11\}\$' then '55' \|\| p\.raw/);
  assert.match(sql, /\(2, p\.raw\)\) v\(ord, digits\)/, "variante antiga (só dígitos) para contas antigas");
  assert.match(sql, /order by c\.ord/, "o normalizado vem primeiro");
  assert.match(sql, /grant execute on function public\.get_employee_login_candidates\(text, text, text\) to service_role/);
  assert.match(sql, /revoke all on function public\.get_employee_login_candidates\(text, text, text\) from public, anon, authenticated/);
  assert.doesNotMatch(sql, /security definer/i);
});

test("seed cria a equipe pelo convite e pela função de ativação reais", () => {
  const seed = read("scripts/dev/seed-dev.mjs");
  for (const rpc of ["create_waiter_invite", "create_kitchen_invite", "create_cashier_invite", "create_driver_invite", "manage_waiter", "manage_kitchen_operator"]) {
    assert.ok(seed.includes(rpc), rpc);
  }
  assert.match(seed, /functions\/v1\/activate-\$\{kind\}-access/);
  assert.match(seed, /if \(url\.includes\(PRODUCTION_REF\) \|\| !url\.includes\(DEV_REF\)\) throw/);
  assert.match(seed, /ensurePilotPlan/);
  const spec = read("tests/e2e-core/staff.spec.ts");
  for (const who of ["garçom", "cozinha", "caixa", "entregador"]) assert.ok(spec.includes(who), who);
});

// Fase 98F. Prova com cenários simulados: scripts/dev/phase98f-alerts-check.sql (9 de 9 em 04/11/2026).
test("alertas cobrem as 5 situações do roteiro do piloto", () => {
  const sql = read("supabase/migrations/20261104133000_phase98f_pilot_alerts.sql");
  for (const rule of ["stuck_order", "payment_failed", "payment_pending", "worker_stale", "printer_offline", "api_error_rate"]) {
    assert.match(sql, new RegExp(`\\('${rule}', `), rule);
  }
});

test("sem duplicar: um alerta aberto por chave, aviso só depois do cooldown", () => {
  const sql = read("supabase/migrations/20261104133000_phase98f_pilot_alerts.sql");
  assert.match(sql, /create unique index if not exists pilot_alerts_open_dedup_idx on public\.pilot_alerts\(dedup_key\) where status = 'open'/);
  assert.match(sql, /a\.last_notified_at < requested_now - make_interval\(mins => rule\.cooldown_minutes\)/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /if not found then\s+insert into public\.notification_inbox_items/);
  assert.match(sql, /'platform'::text as domain, null::uuid as organization_id, 'superadmin'::text as role/);
  assert.match(sql, /select 'tenant', org, 'owner'/);
});

test("worker parado respeita o intervalo do job e 401 conta como erro", () => {
  const sql = read("supabase/migrations/20261104133000_phase98f_pilot_alerts.sql");
  assert.match(sql, /greatest\(make_interval\(mins => r\.threshold::int\), 2 \* coalesce\(w\.gap, interval '0'\)\)/);
  assert.match(sql, /h\.status_code not between 200 and 299/);
});

test("avaliação só pelo banco e agendamento de produção fora da migration", () => {
  const sql = read("supabase/migrations/20261104133000_phase98f_pilot_alerts.sql");
  assert.match(sql, /revoke all on function private\.evaluate_pilot_alerts\(timestamptz\) from public, anon, authenticated/);
  assert.doesNotMatch(sql, /cron\.schedule/);
  assert.match(read("scripts/dev/pilot-alerts-cron.sql"), /cron\.schedule\('masterapp-pilot-alerts', '\*\/5 \* \* \* \*'/);
  const check = read("scripts/dev/phase98f-alerts-check.sql");
  for (const s of ["cooldown não duplica", "avisa de novo no mesmo item", "resolve alerta", "regra desligada", "anon"]) assert.ok(check.includes(s), s);
  assert.match(read("app/superadmin/alertas/page.tsx"), /from\("pilot_alerts"\)/);
});
