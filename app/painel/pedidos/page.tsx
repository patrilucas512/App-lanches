import { DashboardShell } from "@/components/dashboard-shell";
import { getDashboardContext } from "@/lib/dashboard";

export default async function OrdersPage() {
  const { supabase, establishment } = await getDashboardContext();
  const { data: orders } = await supabase.from("orders").select("id, order_number, customer_name, total_cents, status, created_at").eq("establishment_id", establishment.id).order("created_at", { ascending: false }).limit(100);
  return <DashboardShell active="orders" storeSlug={establishment.slug}><header className="dashboard-head"><div><small>OPERAÇÃO</small><h1>Pedidos.</h1></div><span className="status-pill">{orders?.length ?? 0} registrados</span></header><article className="panel">{orders?.length ? <table className="table"><thead><tr><th>NÚMERO</th><th>CLIENTE</th><th>VALOR</th><th>STATUS</th><th>DATA</th></tr></thead><tbody>{orders.map(order => <tr key={order.id}><td>#{order.order_number}</td><td>{order.customer_name}</td><td>{new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(order.total_cents/100)}</td><td>{order.status}</td><td>{new Date(order.created_at).toLocaleDateString("pt-BR")}</td></tr>)}</tbody></table> : <div className="empty"><b>Nenhum pedido ainda.</b><span>Os pedidos reais da sua loja aparecerão aqui.</span></div>}</article></DashboardShell>;
}
