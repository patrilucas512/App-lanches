import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveManagerPeriod } from "../lib/intelligence/periods.ts";

const root = new URL("../", import.meta.url);
const [migration, tools, page, component, dashboard, route, shell] = await Promise.all([
  readFile(new URL("supabase/migrations/20261010045144_manager_copilot_phase9.sql", root), "utf8"),
  readFile(new URL("lib/intelligence/copilot-tools.ts", root), "utf8"),
  readFile(new URL("app/painel/inteligencia/page.tsx", root), "utf8"),
  readFile(new URL("components/manager-copilot.tsx", root), "utf8"),
  readFile(new URL("app/painel/page.tsx", root), "utf8"),
  readFile(new URL("app/api/intelligence/route.ts", root), "utf8"),
  readFile(new URL("components/dashboard-shell.tsx", root), "utf8"),
]);

test("1. resumo de vendas usa a camada central de métricas", () => assert.match(migration, /private\.manager_sales_summary[\s\S]*approved_orders[\s\S]*revenue_cents/));
test("2. comparação de períodos é explícita", () => assert.match(migration, /current_sales:=private\.manager_sales_summary[\s\S]*previous_sales:=private\.manager_sales_summary/));
test("3. hoje compara até o mesmo horário de ontem", () => {
  const range = resolveManagerPeriod("today", "America/Sao_Paulo", new Date("2026-10-10T17:00:00Z"));
  assert.equal(range.start, "2026-10-10T03:00:00.000Z"); assert.equal(range.compareEnd, "2026-10-09T17:00:00.000Z"); assert.equal(range.sameHour, true);
});
test("4. receita considera apenas pedidos concluídos ou pagamento aprovado", () => assert.match(migration, /sum\(o\.total_cents\) filter\(where o\.status='completed' or o\.online_payment_status='approved'\)/));
test("5. ticket médio reutiliza a mesma população aprovada", () => assert.match(migration, /average_ticket_cents[\s\S]*avg\(o\.total_cents\) filter\(where o\.status='completed' or o\.online_payment_status='approved'\)/));
test("6. pedidos distinguem aprovados, pendentes e totais", () => assert.match(migration, /total_orders[\s\S]*approved_orders[\s\S]*pending_orders/));
test("7. cancelamentos incluem status operacional e financeiro", () => assert.match(migration, /cancelled_orders[\s\S]*canceled','declined','refunded','charged_back/));
test("8. produtos medem quantidade, receita, adicionais e cancelamentos", () => assert.match(migration, /addon_rate_percent[\s\S]*cancelled_quantity/));
test("9. unidades são comparadas somente no escopo autorizado", () => assert.match(migration, /all_units:=requested_all_units[\s\S]*e\.id=any\(store_ids\)/));
test("10. atendimento mede fila e resolução", () => assert.match(migration, /'waiting'[\s\S]*'in_progress'[\s\S]*average_resolution_minutes/));
test("11. SLA é parte da análise operacional", () => { assert.match(migration, /sla_breached/); assert.match(migration, /SLA acima do esperado/); });
test("12. campanhas usam atribuição real de receita", () => { assert.match(migration, /crm_campaign_attributions/); assert.match(migration, /conversion_percent/); });
test("13. CRM diferencia novos, recorrentes, inativos e VIP", () => assert.match(migration, /new_customers[\s\S]*recurring_customers[\s\S]*inactive_customers[\s\S]*vip_customers/));
test("14. IA mede fallback, transferência, pedidos e receita", () => assert.match(migration, /ai_message_processed[\s\S]*ai_fallback[\s\S]*ai_handoff[\s\S]*ai_order_created/));
test("15. alertas têm níveis e ações seguras", () => { assert.match(migration, /'level','critical'|'level','attention'/); assert.match(component, /Configurar alertas/); });
test("16. baseline usa histórico de 28 dias e mesmo dia da semana", () => assert.match(migration, /metric_date.*-28[\s\S]*same_weekday_average_revenue_cents/));
test("17. anomalias exigem amostra mínima", () => assert.match(migration, /sample>=settings\.minimum_order_sample/));
test("18. permissões são granulares", () => assert.match(migration, /can_view_sales[\s\S]*can_view_team[\s\S]*can_view_campaigns[\s\S]*can_view_costs[\s\S]*can_view_all_units[\s\S]*can_configure_alerts/));
test("19. isolamento multiempresa e multiunidade é aplicado no backend", () => { assert.match(migration, /organization_id=org_id[\s\S]*store_ids/); assert.match(migration, /private\.has_manager_copilot_permission/); });
test("20. falha da IA não derruba as métricas estruturadas", () => { assert.match(route, /métricas estruturadas continuam disponíveis/); assert.match(component, /initialSnapshot/); });
test("21. dashboard e Copiloto chamam a mesma metric layer", () => { assert.match(dashboard, /get_manager_copilot_snapshot/); assert.match(page, /get_manager_copilot_snapshot/); });
test("22. previsão aparece explicitamente como estimativa", () => { assert.match(migration, /'estimated',true,'label','Estimativa'/); assert.match(component, /não é garantia|não é garantia/i); });
test("Copiloto nunca consulta o banco diretamente", () => { assert.doesNotMatch(tools, /\.from\(|\.rpc\(/); assert.match(route, /get_manager_copilot_snapshot/); });
test("consultas, ferramentas e fontes são auditadas sem raciocínio privado", () => assert.match(migration, /manager_copilot_query_audit[\s\S]*tools_used[\s\S]*data_sources/));
test("feedback é opt-in e não gera aprendizado irrestrito", () => assert.match(migration, /save_manager_copilot_feedback[\s\S]*requested_useful/));
test("menu administrativo inclui Inteligência", () => assert.match(shell, /\/painel\/inteligencia[\s\S]*Inteligência/));
