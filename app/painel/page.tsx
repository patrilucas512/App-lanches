import Link from "next/link";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { StoreStatusControl } from "@/components/store-status-control";
import { getDashboardContext } from "@/lib/dashboard";
import { resolveManagerPeriod } from "@/lib/intelligence/periods";
import { OnboardingHomeCard } from "@/components/onboarding-home-card";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const integer = new Intl.NumberFormat("pt-BR");
const periods = [
  ["today", "Hoje"], ["yesterday", "Ontem"], ["7d", "7 dias"],
  ["month", "Mês"], ["year", "Ano"], ["all", "Total"],
] as const;

type Period = typeof periods[number][0];
type Order = {
  id: string; order_number: number; customer_name: string; total_cents: number; status: string;
  created_at: string; fulfillment_type: string; payment_method: string | null;
  online_payment_status: string | null; delivery_fee_cents: number;
};
type ChartPoint = { label: string; value: number };

function rangeFor(period: Period) {
  const now = new Date();
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  let end: Date | null = null;
  if (period === "yesterday") { end = new Date(start); start.setDate(start.getDate() - 1); }
  if (period === "7d") start.setDate(start.getDate() - 6);
  if (period === "month") start.setDate(1);
  if (period === "year") start.setMonth(0, 1);
  if (period === "all") return { start: null, end: null };
  return { start, end };
}

function approved(order: Order) {
  return order.status === "completed" || order.online_payment_status === "approved";
}

function canceled(order: Order) {
  return order.status === "canceled" || ["canceled", "declined", "refunded", "charged_back"].includes(order.online_payment_status ?? "");
}

function chartPoints(orders: Order[], period: Period): ChartPoint[] {
  const values = new Map<string, number>();
  for (const order of orders.filter(approved)) {
    const date = new Date(order.created_at);
    const key = period === "today" || period === "yesterday"
      ? String(date.getHours()).padStart(2, "0")
      : period === "year" || period === "all"
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
        : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    values.set(key, (values.get(key) ?? 0) + order.total_cents);
  }
  if (period === "today" || period === "yesterday") {
    return Array.from({ length: 24 }, (_, hour) => ({ label: `${String(hour).padStart(2, "0")}h`, value: values.get(String(hour).padStart(2, "0")) ?? 0 }));
  }
  if (period === "7d" || period === "month") {
    const { start } = rangeFor(period); const last = new Date(); const result: ChartPoint[] = [];
    for (const cursor = new Date(start!); cursor <= last; cursor.setDate(cursor.getDate() + 1)) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
      result.push({ label: cursor.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), value: values.get(key) ?? 0 });
    }
    return result;
  }
  const months = [...values.keys()].sort();
  const keys = period === "all" ? months.slice(-12) : Array.from({ length: 12 }, (_, month) => `${new Date().getFullYear()}-${String(month + 1).padStart(2, "0")}`);
  return keys.map(key => ({ label: new Date(`${key}-02T12:00:00`).toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""), value: values.get(key) ?? 0 }));
}

function SalesChart({ points }: { points: ChartPoint[] }) {
  const max = Math.max(...points.map(point => point.value), 100);
  const coordinates = points.map((point, index) => {
    const x = points.length === 1 ? 450 : 28 + (index / (points.length - 1)) * 844;
    const y = 254 - (point.value / max) * 210;
    return { ...point, x, y };
  });
  const line = coordinates.map(point => `${point.x},${point.y}`).join(" ");
  const area = `28,254 ${line} 872,254`;
  const shownLabels = coordinates.filter((_, index) => index === 0 || index === coordinates.length - 1 || index % Math.max(1, Math.ceil(coordinates.length / 6)) === 0);
  return <div className="sales-chart" aria-label="Gráfico de faturamento aprovado"><svg viewBox="0 0 900 292" role="img">
    {[44, 96, 149, 201, 254].map(y => <line key={y} x1="28" x2="872" y1={y} y2={y} className="chart-grid-line" />)}
    <polygon points={area} className="chart-area" /><polyline points={line} className="chart-line" />
    {coordinates.map((point, index) => point.value > 0 && <circle key={index} cx={point.x} cy={point.y} r="5" className="chart-dot"><title>{point.label}: {money.format(point.value / 100)}</title></circle>)}
    {shownLabels.map((point, index) => <text key={index} x={point.x} y="282" textAnchor="middle">{point.label}</text>)}
  </svg></div>;
}

function Breakdown({ title, rows }: { title: string; rows: { label: string; value: number }[] }) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return <article className="analytics-panel"><header><small>DISTRIBUIÇÃO</small><h2>{title}</h2></header><div className="breakdown-list">
    {rows.map(row => { const percent = total ? Math.round(row.value / total * 100) : 0; return <div key={row.label}><span><b>{row.label}</b><small>{row.value} · {percent}%</small></span><i><em style={{ width: `${percent}%` }} /></i></div>; })}
    {!rows.length && <div className="analytics-empty">Sem dados no período.</div>}
  </div></article>;
}

const statusLabels: Record<string, string> = { new: "Novo", confirmed: "Confirmado", preparing: "Em preparo", ready: "Pronto", out_for_delivery: "Em rota", completed: "Concluído", canceled: "Cancelado" };
const fulfillmentLabels: Record<string, string> = { delivery: "Entrega", pickup: "Retirada", takeaway: "Viagem", dine_in: "Salão" };
const paymentLabels: Record<string, string> = { cash: "Dinheiro", money: "Dinheiro", card: "Cartão", credit_card: "Cartão", debit_card: "Cartão", pix: "Pix", mercado_pago_online: "Mercado Pago", pagarme_online: "Pagar.me" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { supabase, establishment, member } = await getDashboardContext();
  if (member.role === "attendant") redirect("/painel/garcom");
  const requested = (await searchParams).period;
  const period: Period = periods.some(([key]) => key === requested) ? requested as Period : "today";
  const { start, end } = rangeFor(period);

  let orderQuery = supabase.from("orders").select("id,order_number,customer_name,total_cents,status,created_at,fulfillment_type,payment_method,online_payment_status,delivery_fee_cents").eq("establishment_id", establishment.id).order("created_at", { ascending: false }).limit(5000);
  let deliveryQuery = supabase.from("deliveries").select("id,status,customer_delivery_fee_cents,created_at,delivered_at").eq("establishment_id", establishment.id).order("created_at", { ascending: false }).limit(5000);
  if (start) { orderQuery = orderQuery.gte("created_at", start.toISOString()); deliveryQuery = deliveryQuery.gte("created_at", start.toISOString()); }
  if (end) { orderQuery = orderQuery.lt("created_at", end.toISOString()); deliveryQuery = deliveryQuery.lt("created_at", end.toISOString()); }
  const [{ data: rawOrders }, { data: deliveries }, { count: activeProducts }, { data: serviceMode }, { data: onboarding }] = await Promise.all([
    orderQuery, deliveryQuery,
    supabase.from("products").select("id", { count: "exact", head: true }).eq("establishment_id", establishment.id).eq("active", true),
    supabase.from("service_modes").select("store_open").eq("establishment_id", establishment.id).single(),
    supabase.from("onboarding_sessions").select("progress_percent,current_step,status").eq("organization_id",establishment.organization_id).eq("establishment_id",establishment.id).maybeSingle(),
  ]);
  const sharedMetricKey = period === "today" || period === "yesterday" || period === "7d" || period === "month" ? period : null;
  const sharedRange = sharedMetricKey ? resolveManagerPeriod(sharedMetricKey, establishment.timezone || "America/Sao_Paulo") : null;
  const { data: sharedSnapshot } = sharedRange ? await supabase.rpc("get_manager_copilot_snapshot", {
    requested_establishment_id: establishment.id, requested_start: sharedRange.start, requested_end: sharedRange.end,
    requested_compare_start: sharedRange.compareStart, requested_compare_end: sharedRange.compareEnd, requested_all_units: false,
  }) : { data: null };
  const orders = (rawOrders ?? []) as Order[];
  const approvedOrders = orders.filter(approved); const canceledOrders = orders.filter(canceled);
  const pendingOrders = orders.filter(order => !approved(order) && !canceled(order));
  const approvedIds = approvedOrders.map(order => order.id).slice(0, 1000);
  const { data: items } = approvedIds.length
    ? await supabase.from("order_items").select("order_id,product_name,quantity,total_cents").eq("establishment_id", establishment.id).in("order_id", approvedIds)
    : { data: [] };

  const sharedSales = sharedSnapshot?.sales as Record<string, number> | undefined;
  const revenue = Number(sharedSales?.revenue_cents ?? approvedOrders.reduce((sum, order) => sum + order.total_cents, 0));
  const approvedCount = Number(sharedSales?.approved_orders ?? approvedOrders.length);
  const canceledCount = Number(sharedSales?.cancelled_orders ?? canceledOrders.length);
  const pendingCount = Number(sharedSales?.pending_orders ?? pendingOrders.length);
  const averageTicket = Number(sharedSales?.average_ticket_cents ?? (approvedOrders.length ? Math.round(revenue / approvedOrders.length) : 0));
  const approvalRate = Number(sharedSales?.approved_percent ?? (orders.length ? Math.round(approvedOrders.length / orders.length * 100) : 0));
  const productQuantity = (items ?? []).reduce((sum, item) => sum + item.quantity, 0);
  const refunds = orders.filter(order => ["refunded", "charged_back"].includes(order.online_payment_status ?? ""));
  const refundAmount = refunds.reduce((sum, order) => sum + order.total_cents, 0);
  const finishedDeliveries = (deliveries ?? []).filter(delivery => delivery.status === "delivered");
  const activeDeliveries = (deliveries ?? []).filter(delivery => !["delivered", "canceled", "failed", "returned_to_store"].includes(delivery.status));
  const deliveryFees = finishedDeliveries.reduce((sum, delivery) => sum + delivery.customer_delivery_fee_cents, 0);
  const averageDeliveryMinutes = finishedDeliveries.length ? Math.round(finishedDeliveries.reduce((sum, delivery) => sum + (delivery.delivered_at ? (new Date(delivery.delivered_at).getTime() - new Date(delivery.created_at).getTime()) / 60000 : 0), 0) / finishedDeliveries.length) : 0;
  const countBy = (key: "fulfillment_type" | "payment_method", labels: Record<string, string>) => Object.entries(orders.reduce<Record<string, number>>((result, order) => { const value = order[key] || "other"; result[value] = (result[value] ?? 0) + 1; return result; }, {})).map(([label, value]) => ({ label: labels[label] ?? "Outros", value })).sort((a, b) => b.value - a.value);
  const topProducts = Object.values((items ?? []).reduce<Record<string, { label: string; value: number; amount: number }>>((result, item) => { const key = item.product_name; result[key] ??= { label: key, value: 0, amount: 0 }; result[key].value += item.quantity; result[key].amount += item.total_cents; return result; }, {})).sort((a, b) => b.value - a.value).slice(0, 5);
  const points = chartPoints(orders, period);

  return <DashboardShell brand={establishment} storeSlug={establishment.slug} role={member.role}>
    {!establishment.onboarding_completed && <OnboardingHomeCard progress={Number(onboarding?.progress_percent||0)} currentStep={onboarding?.current_step}/>} 
    <header className="dashboard-head analytics-head"><div><small>RESULTADOS DO ESTABELECIMENTO</small><h1>Dashboard de vendas.</h1><p>Acompanhe financeiro, pedidos, produtos e entregas em um só lugar.</p></div><StoreStatusControl establishmentId={establishment.id} initialOpen={serviceMode?.store_open ?? true} /></header>
    <nav className="analytics-periods" aria-label="Período do dashboard">{periods.map(([key, label]) => <Link key={key} className={period === key ? "active" : ""} href={key === "today" ? "/painel" : `/painel?period=${key}`}>{label}</Link>)}</nav>

    <section className="analytics-kpis" aria-label="Indicadores principais">
      <article className="analytics-kpi featured"><span className="analytics-icon">$</span><small>FATURAMENTO APROVADO</small><strong>{money.format(revenue / 100)}</strong><p>Ticket médio: {money.format(averageTicket / 100)}</p></article>
      <article className="analytics-kpi featured"><span className="analytics-icon">✓</span><small>VENDAS APROVADAS</small><strong>{integer.format(approvedCount)}</strong><p>{integer.format(productQuantity)} item(ns) vendido(s)</p></article>
      <article className="analytics-kpi"><span className="analytics-icon">◷</span><small>PEDIDOS PENDENTES</small><strong>{integer.format(pendingCount)}</strong><p>Aguardando conclusão</p></article>
      <article className="analytics-kpi"><span className="analytics-icon">↗</span><small>TAXA DE APROVAÇÃO</small><strong>{approvalRate}%</strong><p>{integer.format(orders.length)} pedido(s) no período</p></article>
    </section>

    <section className="analytics-main-grid">
      <article className="analytics-panel sales-performance"><header><div><small>DESEMPENHO</small><h2>Faturamento aprovado</h2><p>Receita dos pedidos concluídos no período selecionado.</p></div><span>BRL</span></header><SalesChart points={points} /></article>
      <div className="analytics-side-stats">
        <article className="analytics-mini"><small>VENDAS CANCELADAS</small><strong>{integer.format(canceledCount)}</strong><p>{money.format(canceledOrders.reduce((sum, order) => sum + order.total_cents, 0) / 100)}</p></article>
        <article className="analytics-mini"><small>REEMBOLSOS E CHARGEBACKS</small><strong>{money.format(refundAmount / 100)}</strong><p>{refunds.length} ocorrência(s)</p></article>
        <article className="analytics-mini"><small>PRODUTOS VENDIDOS</small><strong>{integer.format(productQuantity)}</strong><p>{activeProducts ?? 0} produto(s) ativo(s)</p></article>
      </div>
    </section>

    <section className="delivery-summary"><header><div><small>DELIVERY</small><h2>Operação de entregas</h2></div><Link href="/painel/pedidos#despacho-entregas">Monitorar entregas →</Link></header><div>
      <article><small>ENTREGAS RECEBIDAS</small><strong>{deliveries?.length ?? 0}</strong></article><article><small>EM ANDAMENTO</small><strong>{activeDeliveries.length}</strong></article><article><small>CONCLUÍDAS</small><strong>{finishedDeliveries.length}</strong></article><article><small>TEMPO MÉDIO</small><strong>{averageDeliveryMinutes ? `${averageDeliveryMinutes} min` : "—"}</strong></article><article><small>TAXAS DE ENTREGA</small><strong>{money.format(deliveryFees / 100)}</strong></article>
    </div></section>

    <section className="analytics-breakdowns"><Breakdown title="Origem dos pedidos" rows={countBy("fulfillment_type", fulfillmentLabels)} /><Breakdown title="Formas de pagamento" rows={countBy("payment_method", paymentLabels)} />
      <article className="analytics-panel"><header><small>DESTAQUES</small><h2>Produtos mais vendidos</h2></header><div className="top-products">{topProducts.map((product, index) => <div key={product.label}><span>{index + 1}</span><b>{product.label}</b><small>{product.value} un. · {money.format(product.amount / 100)}</small></div>)}{!topProducts.length && <div className="analytics-empty">Sem produtos vendidos no período.</div>}</div></article>
    </section>

    <article className="analytics-panel recent-sales"><header><div><small>ÚLTIMAS MOVIMENTAÇÕES</small><h2>Pedidos recentes</h2></div><Link href="/painel/pedidos">Ver todos →</Link></header>{orders.length ? <div className="analytics-table-wrap"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Canal</th><th>Pagamento</th><th>Valor</th><th>Status</th></tr></thead><tbody>{orders.slice(0, 8).map(order => <tr key={order.id}><td>#{order.order_number}</td><td>{order.customer_name}</td><td>{fulfillmentLabels[order.fulfillment_type] ?? order.fulfillment_type}</td><td>{paymentLabels[order.payment_method ?? ""] ?? order.payment_method ?? "Não informado"}</td><td>{money.format(order.total_cents / 100)}</td><td><span className={`analytics-status status-${order.status}`}>{statusLabels[order.status] ?? order.status}</span></td></tr>)}</tbody></table></div> : <div className="analytics-empty">Nenhum pedido encontrado no período selecionado.</div>}</article>
  </DashboardShell>;
}
