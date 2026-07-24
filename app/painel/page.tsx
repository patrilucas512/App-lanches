import { DashboardShell } from "@/components/dashboard-shell";
import { getDashboardContext } from "@/lib/dashboard";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export default async function DashboardPage() {
  const { supabase, establishment } = await getDashboardContext();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [{ data: orders }, { count: products }, { data: subscription }] = await Promise.all([
    supabase.from("orders").select("id, order_number, customer_name, total_cents, status, created_at").eq("establishment_id", establishment.id).gte("created_at", today.toISOString()).order("created_at", { ascending: false }).limit(6),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("establishment_id", establishment.id),
    supabase.from("subscriptions").select("status, trial_ends_at, current_period_end, plans(name)").eq("establishment_id", establishment.id).single(),
  ]);
  const revenue = (orders ?? []).reduce((total, order) => total + order.total_cents, 0);
  return <DashboardShell storeSlug={establishment.slug}>
    <header className="dashboard-head"><div><small>VISÃO GERAL</small><h1>Olá, {establishment.name}.</h1></div><span className="status-pill">● Loja ativa</span></header>
    <div className="dashboard-cards">
      <article className="dash-card"><small>FATURAMENTO HOJE</small><strong>{money.format(revenue / 100)}</strong></article>
      <article className="dash-card"><small>PEDIDOS HOJE</small><strong>{orders?.length ?? 0}</strong></article>
      <article className="dash-card"><small>PRODUTOS CADASTRADOS</small><strong>{products ?? 0}</strong></article>
      <article className="dash-card"><small>PLANO ATUAL</small><strong>{(subscription?.plans as unknown as { name?: string })?.name ?? "Essencial"}</strong></article>
    </div>
    <div className="panel-grid"><article className="panel"><h2>Pedidos recentes</h2>{orders?.length ? <table className="table"><thead><tr><th>PEDIDO</th><th>CLIENTE</th><th>VALOR</th><th>STATUS</th></tr></thead><tbody>{orders.map(order => <tr key={order.id}><td>#{order.order_number}</td><td>{order.customer_name}</td><td>{money.format(order.total_cents / 100)}</td><td>{order.status}</td></tr>)}</tbody></table> : <div className="empty"><b>Seu primeiro pedido aparecerá aqui.</b><span>Compartilhe o link da sua loja para começar.</span></div>}</article><article className="panel"><h2>Próximos passos</h2><div className="empty"><b>Deixe sua loja pronta</b><span>Cadastre produtos, ajuste horários e personalize o atendimento.</span></div></article></div>
  </DashboardShell>;
}
