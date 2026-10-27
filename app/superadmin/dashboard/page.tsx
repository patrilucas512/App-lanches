import { BarChart, Empty, Metric, PageHead } from "@/components/superadmin-ui";
import { money, requireSuperadmin } from "@/lib/superadmin";

export default async function SuperadminDashboard() {
  const { supabase } = await requireSuperadmin();
  const startMonth = new Date(); startMonth.setDate(1); startMonth.setHours(0, 0, 0, 0);
  const [storesQ, subsQ, ordersQ, monthOrdersQ, customersQ, scansQ, waitersQ, callsQ, kitchenQ, pixQ, cardQ, proofsQ, plansQ] = await Promise.all([
    supabase.from("establishments").select("id,active,blocked_at,created_at,name"),
    supabase.from("subscriptions").select("id,status,billing_cycle,created_at,plan_id,plans(name,monthly_price_cents,annual_price_cents)"),
    supabase.from("orders").select("id,total_cents,payment_method,created_at"),
    supabase.from("orders").select("id", { count: "exact", head: true }).gte("created_at", startMonth.toISOString()),
    supabase.from("customers").select("id", { count: "exact", head: true }),
    supabase.from("qr_code_scans").select("id", { count: "exact", head: true }),
    supabase.from("waiters").select("id", { count: "exact", head: true }),
    supabase.from("waiter_calls").select("id", { count: "exact", head: true }),
    supabase.from("kitchen_tickets").select("id", { count: "exact", head: true }),
    supabase.from("order_payment_transactions").select("id", { count: "exact", head: true }).eq("provider", "mercado_pago"),
    supabase.from("orders").select("id", { count: "exact", head: true }).ilike("payment_method", "%card%"),
    supabase.from("payment_proofs").select("id", { count: "exact", head: true }),
    supabase.from("plans").select("id,name"),
  ]);
  const stores = storesQ.data ?? []; const subs = subsQ.data ?? []; const orders = ordersQ.data ?? [];
  const active = subs.filter(s => s.status === "active"); const trial = subs.filter(s => s.status === "trialing"); const pastDue = subs.filter(s => ["past_due", "unpaid"].includes(s.status));
  const monthly = active.reduce((sum, s) => { const p = Array.isArray(s.plans) ? s.plans[0] : s.plans; return sum + (s.billing_cycle === "annual" ? Math.round((p?.annual_price_cents ?? 0) / 12) : (p?.monthly_price_cents ?? 0)); }, 0);
  const monthLabels = Array.from({ length: 6 }, (_, index) => { const d = new Date(); d.setMonth(d.getMonth() - (5 - index), 1); return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleDateString("pt-BR", { month: "short" }) }; });
  const growth = monthLabels.map(m => ({ label: m.label, value: stores.filter(s => s.created_at.startsWith(m.key)).length }));
  const byPlan = (plansQ.data ?? []).map(plan => ({ label: plan.name, value: subs.filter(s => s.plan_id === plan.id).length }));
  return <><PageHead title="Visão geral da plataforma" description="Acompanhe clientes, recorrência e uso operacional sem dados simulados." /><section className="sa-metrics"><Metric label="Estabelecimentos" value={stores.length} note={`${stores.filter(s => s.active).length} ativos`} /><Metric label="Em teste grátis" value={trial.length} tone="info" /><Metric label="Inadimplentes" value={pastDue.length} tone="warning" /><Metric label="Bloqueados" value={stores.filter(s => s.blocked_at).length} tone="danger" /><Metric label="Assinaturas ativas" value={active.length} /><Metric label="Canceladas" value={subs.filter(s => s.status === "canceled").length} /><Metric label="MRR estimado" value={money(monthly)} note="Somente assinaturas ativas" /><Metric label="ARR estimado" value={money(monthly * 12)} /><Metric label="Pedidos gerados" value={orders.length} note={`${monthOrdersQ.count ?? 0} neste mês`} /><Metric label="Movimentado em pedidos" value={money(orders.reduce((s, o) => s + (o.total_cents ?? 0), 0))} /><Metric label="Clientes finais" value={customersQ.count ?? 0} /><Metric label="Leituras de QR Code" value={scansQ.count ?? 0} /></section><section className="sa-chart-grid"><article className="sa-panel"><header><div><small>CRESCIMENTO</small><h2>Novos estabelecimentos</h2></div></header><BarChart rows={growth} /></article><article className="sa-panel"><header><div><small>CARTEIRA</small><h2>Assinaturas por plano</h2></div></header><BarChart rows={byPlan} /></article></section><section className="sa-panel"><header><div><small>USO DA PLATAFORMA</small><h2>Operação consolidada</h2></div></header><div className="sa-usage-grid"><Metric label="Garçons" value={waitersQ.count ?? 0} /><Metric label="Chamados" value={callsQ.count ?? 0} /><Metric label="Pedidos na cozinha" value={kitchenQ.count ?? 0} /><Metric label="Pix gerados" value={pixQ.count ?? 0} /><Metric label="Cartões registrados" value={cardQ.count ?? 0} /><Metric label="Comprovantes" value={proofsQ.count ?? 0} /></div>{!orders.length && <Empty title="Nenhum pedido registrado ainda" text="A movimentação dos estabelecimentos aparecerá aqui assim que houver pedidos reais." />}</section></>;
}
