import Link from "next/link";
import { Empty, Metric, PageHead } from "@/components/superadmin-ui";
import { date, requireSuperadmin } from "@/lib/superadmin";

// Fase 99H: painel do piloto (só leitura). Números agregados do dia por loja, vindos de
// public.superadmin_pilot_overview(); nenhum dado de cliente chega aqui.
type Store = { id: string; name: string; slug: string; orders_today: number; orders_by_status: Record<string, number>; stuck_orders: number;
  avg_queue_min: number | null; avg_prep_min: number | null; avg_delivery_min: number | null; payment_failures_today: number;
  payments_pending: number; printers: { name: string; last_seen_at: string | null }[]; open_alerts: number; pilot_tickets_open: number };
type Overview = { generated_at: string; stuck_minutes: number; stores: Store[]; open_alerts: number; errors_24h: number;
  top_errors: { route: string; error_name: string; total: number; last_at: string }[]; pilot_tickets_open: number };

const STATUS: Record<string, string> = { new: "Novo", confirmed: "Confirmado", preparing: "Em preparo", ready: "Pronto",
  out_for_delivery: "Saiu para entrega", delivered: "Entregue", completed: "Concluído", canceled: "Cancelado" };
const minutes = (value: number | null) => (value == null ? "—" : `${value} min`);

export default async function PilotPanelPage() {
  const { supabase } = await requireSuperadmin();
  const { data, error } = await supabase.rpc("superadmin_pilot_overview");
  const overview = data as Overview | null;
  if (error || !overview) return <><PageHead eyebrow="OPERAÇÃO DO PILOTO" title="Painel do piloto" description="Não foi possível carregar os números." /><Empty title="Erro ao carregar" text={error?.message ?? "Sem dados."} /></>;
  const stores = overview.stores ?? [];
  return <>
    <PageHead eyebrow="OPERAÇÃO DO PILOTO" title="Painel do piloto" description={`Números de hoje por loja, só leitura. Atualizado em ${date(overview.generated_at, true)}. Pedido parado: sem avançar há mais de ${overview.stuck_minutes} min.`} />
    <section className="sa-metrics">
      <Metric label="Pedidos hoje" value={stores.reduce((sum, s) => sum + s.orders_today, 0)} />
      <Metric label="Pedidos parados" value={stores.reduce((sum, s) => sum + s.stuck_orders, 0)} tone={stores.some((s) => s.stuck_orders) ? "danger" : "default"} />
      <Metric label="Alertas abertos" value={overview.open_alerts} tone={overview.open_alerts ? "danger" : "default"} note="ver Alertas do piloto" />
      <Metric label="Erros do app (24 h)" value={overview.errors_24h} tone={overview.errors_24h ? "danger" : "default"} />
      <Metric label="Relatos do piloto abertos" value={overview.pilot_tickets_open} note="na Central de Suporte" />
    </section>
    {stores.map((store) => <article className="sa-panel" key={store.id}>
      <h2>{store.name}</h2>
      <div className="sa-log"><div><b>Pedidos de hoje: {store.orders_today}</b>
        <small>{Object.entries(store.orders_by_status ?? {}).map(([status, n]) => `${STATUS[status] ?? status}: ${n}`).join(" · ") || "nenhum pedido hoje"}</small></div></div>
      <div className="sa-log"><div><b>Tempo médio por etapa</b>
        <small>fila da cozinha {minutes(store.avg_queue_min)} · preparo {minutes(store.avg_prep_min)} · entrega {minutes(store.avg_delivery_min)}</small></div></div>
      <div className="sa-log"><div><b>{store.stuck_orders ? "● " : "✓ "}Pedidos parados: {store.stuck_orders}</b>
        <small>Pagamentos falhos hoje: {store.payment_failures_today} · pendentes: {store.payments_pending}</small></div></div>
      <div className="sa-log"><div><b>Impressoras</b>
        <small>{store.printers.length ? store.printers.map((p) => `${p.name}: ${p.last_seen_at ? `sinal ${date(p.last_seen_at, true)}` : "nunca deu sinal"}`).join(" · ") : "nenhuma impressora ativa"}</small></div></div>
      <div className="sa-log"><div><b>Alertas abertos: {store.open_alerts} · Relatos abertos: {store.pilot_tickets_open}</b></div></div>
    </article>)}
    {!stores.length && <Empty title="Nenhuma loja" text="Quando a loja piloto estiver cadastrada, os números aparecem aqui." />}
    <article className="sa-panel">
      <h2>Erros do app nas últimas 24 h</h2>
      {overview.top_errors.map((row) => <div className="sa-log" key={`${row.route}|${row.error_name}`}>
        <div><b>{row.route}</b><small>{row.error_name} · {row.total} vez(es)</small></div><time>{date(row.last_at, true)}</time>
      </div>)}
      {!overview.top_errors.length && <Empty title="Nenhum erro registrado" text="Erros de rota e de API aparecem aqui, sem dados pessoais." />}
    </article>
    <p><Link href="/superadmin/alertas">Alertas do piloto</Link> · <Link href="/superadmin/suporte">Central de Suporte</Link></p>
  </>;
}
