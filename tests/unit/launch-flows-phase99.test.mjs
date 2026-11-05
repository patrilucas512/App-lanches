import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";

// Fases 99E e 99F. Os fluxos completos estão em tests/e2e-core/staff-flows.spec.ts e signup.spec.ts.
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("99E: abrir mesa herda loja e organização (quebrado desde a Fase 42)", () => {
  const sql = read("supabase/migrations/20261105124000_phase99e_table_session_scope.sql");
  assert.match(sql, /create trigger table_sessions_fill_scope before insert on public\.table_sessions/);
  assert.match(sql, /if new\.organization_id is null then/);
  assert.match(sql, /if new\.store_id is null then new\.store_id := new\.establishment_id/);
});

test("99E: loja com zona de entrega sempre tem configuração de entrega", () => {
  const sql = read("supabase/migrations/20261105125000_phase99e_delivery_settings_default.sql");
  assert.match(sql, /create trigger delivery_zones_ensure_settings after insert on public\.delivery_zones/);
  assert.match(sql, /on conflict \(establishment_id\) do nothing/);
  assert.match(sql, /not exists \(select 1 from public\.delivery_settings s where s\.establishment_id = e\.id\)/);
});

test("99E: mudar o pedido não exige a permissão do Copiloto de quem faz a ação", () => {
  const sql = read("supabase/migrations/20261105126000_phase99e_order_metrics_trigger.sql");
  const trigger = sql.slice(sql.indexOf("function private.refresh_manager_daily_metrics_from_order"));
  assert.match(trigger, /perform private\.refresh_manager_daily_metrics_internal\(new\.establishment_id/);
  assert.doesNotMatch(trigger, /perform public\.refresh_manager_daily_metrics\(/);
  const pub = sql.slice(sql.indexOf("function public.refresh_manager_daily_metrics"), sql.indexOf("function private.refresh_manager_daily_metrics_from_order"));
  assert.match(pub, /has_manager_copilot_permission\(requested_establishment_id,'view'\)/);
  assert.match(sql, /revoke all on function private\.refresh_manager_daily_metrics_internal\(uuid, date\) from public, anon, authenticated;/);
});

test("99E: status do motoboy aceita o que o despacho grava", () => {
  const sql = read("supabase/migrations/20261105127000_phase99e_driver_availability_status.sql");
  for (const status of ["offered", "collecting", "blocked", "assigned", "picking_up", "unavailable", "available", "delivering", "paused", "offline"]) {
    assert.match(sql, new RegExp(`'${status}'`), status);
  }
});

test("99E: onboarding mostra a revisão antes de publicar", () => {
  const form = read("components/onboarding-form.tsx");
  assert.match(form, /<button key="next" type="button"/);
  assert.match(form, /<button key="publish" type="submit"/);
});

test("99F: CSS do painel fora do globals e nenhuma classe exclusiva do painel em rota pública", () => {
  const size = statSync(new URL("../../app/globals.css", import.meta.url)).size;
  assert.ok(size < 200 * 1024, `globals.css com ${Math.round(size / 1024)} KB`);
  assert.match(read("components/dashboard-shell.tsx"), /import "@\/app\/painel\/dashboard\.css";/);
  assert.match(read("components/superadmin-shell.tsx"), /import "@\/app\/painel\/dashboard\.css";/);
  const out = execFileSync(process.execPath, ["scripts/quality/split-dashboard-css.mjs", "--verify"], { cwd: new URL("../..", import.meta.url), encoding: "utf8" });
  assert.match(out, /^ok:/);
});

test("99F: contraste dos campos, do onboarding, do despacho e da sacola; letras legíveis no cardápio", () => {
  const css = read("app/globals.css");
  assert.match(css, /\.field input,\.field select,\.field textarea \{ background:white; color:#151515;/);
  assert.match(css, /\.bag-button b \{[^}]*color:#fff;[^}]*font-size:10px;/);
  assert.match(css, /\.menu-page \.product-info p,\.ingredient-summary \{ font-size:12px; \}/);
  // checkout segue o tema do cardápio: sem as cores do tema de operação e sem variáveis fixadas no style
  assert.match(css, /\.menu-page \.checkout-card \.field label,[^{]*\{ color:var\(--menu-text\);/);
  assert.match(css, /\.menu-page \.checkout-card input,\.menu-page \.checkout-card select,\.menu-page \.checkout-card textarea \{ background:var\(--menu-surface\); color:var\(--menu-surface-text\);/);
  assert.doesNotMatch(css, /checkout-card[^{]*\{[^}]*var\(--op-/);
  assert.doesNotMatch(read("components/public-menu.tsx"), /"--menu-surface-text":/);
  const dash = read("app/painel/dashboard.css") + css;
  assert.match(dash, /\.dispatch-card \.dispatch-eta b \{ color: #2b1d08; \}/);
  // o tema da loja força inherit no cartão de despacho; a correção precisa da mesma força
  assert.match(dash, /\.establishment-theme \.dashboard-content \.dispatch-card \.dispatch-eta b \{ color: #2b1d08; \}/);
  assert.match(dash, /:is\(\.admin-theme,\.establishment-theme,\.operation-dashboard\) \.field label\.photo-picker span \{ color:#2a211b; \}/);
});
