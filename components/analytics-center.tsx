"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type AnalyticsData = Record<string, any> & {
  summary?: { orders: number; approved: number; cancelled: number; gmvCents: number; revenueCents: number; averageTicketCents: number };
  freshness?: { lastSync?: string | null; generatedAt?: string; stale?: boolean };
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const integer = new Intl.NumberFormat("pt-BR");
const periods = [[7, "7 dias"], [30, "30 dias"], [90, "90 dias"], [365, "12 meses"]] as const;

function value(v: unknown) { return Number(v || 0); }
function dateLabel(v?: string | null) { return v ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(v)) : "Nunca"; }

export function AnalyticsCenter({ organizationId = null, internal = false }: { organizationId?: string | null; internal?: boolean }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [tab, setTab] = useState("overview");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const dates = useMemo(() => ({ to: new Date().toISOString().slice(0, 10), from: new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10) }), [days]);
  const api = useCallback(async () => {
    const query = new URLSearchParams({ from: dates.from, to: dates.to });
    if (organizationId) query.set("organization_id", organizationId);
    const response = await fetch(`/api/analytics?${query}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Falha ao carregar analytics.");
    setData(body);
  }, [dates, organizationId]);
  useEffect(() => { api().catch(error => setNotice(error.message)); }, [api]);

  async function action(actionName: string, extra: Record<string, unknown> = {}) {
    setBusy(actionName); setNotice("");
    try {
      const response = await fetch("/api/analytics", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: actionName, organization_id: organizationId, confirmed: true, reason: `Ação confirmada no Centro de Analytics: ${actionName}`, ...extra }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível concluir.");
      setNotice(actionName === "sync" ? `${integer.format(body.loaded || 0)} registros processados com sucesso.` : "Solicitação registrada com auditoria.");
      await api();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Falha inesperada."); }
    finally { setBusy(""); }
  }

  if (!data) return <div className="analytics-hub analytics-loading">Preparando a plataforma de dados…</div>;
  const s = data.summary || { orders: 0, approved: 0, cancelled: 0, gmvCents: 0, revenueCents: 0, averageTicketCents: 0 };
  const max = Math.max(1, ...(data.dailyOrders || []).map((x: any) => value(x.revenue_cents)));
  const tabs = [["overview", "Visão executiva"], ["catalog", "Catálogo"], ["quality", "Qualidade"], ["dashboards", "Dashboards"], ["operations", "Operação de dados"]];
  return <div className="analytics-hub">
    {notice && <div className="analytics-notice"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Fechar">×</button></div>}
    <section className="analytics-trust">
      <div><small>DATA PLATFORM · FASE 34</small><b>{internal ? "BI corporativo do MasterApp" : "Analytics da organização"}</b><span>OLTP preservado · warehouse incremental · métricas certificadas</span></div>
      <div className={data.freshness?.stale ? "stale" : "fresh"}><i />Dados {data.freshness?.stale ? "desatualizados" : "atualizados"}<small>Última sincronização: {dateLabel(data.freshness?.lastSync)}</small></div>
    </section>
    <div className="analytics-toolbar"><nav>{tabs.map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}</nav><div>{periods.map(([n, label]) => <button key={n} className={days === n ? "active" : ""} onClick={() => setDays(n)}>{label}</button>)}</div></div>

    {tab === "overview" && <>
      <section className="analytics-kpis">
        <article><small>FATURAMENTO APROVADO</small><strong>{money.format(s.revenueCents / 100)}</strong><span>Fonte certificada</span></article>
        <article><small>VENDAS APROVADAS</small><strong>{integer.format(s.approved)}</strong><span>{integer.format(s.orders)} pedidos</span></article>
        <article><small>TICKET MÉDIO</small><strong>{money.format(s.averageTicketCents / 100)}</strong><span>No período</span></article>
        <article><small>VENDAS CANCELADAS</small><strong>{integer.format(s.cancelled)}</strong><span>Monitoradas</span></article>
        <article><small>GMV</small><strong>{money.format(s.gmvCents / 100)}</strong><span>Volume bruto</span></article>
      </section>
      <section className="analytics-grid">
        <article className="analytics-card analytics-wide"><header><div><small>SÉRIE HISTÓRICA</small><h2>Desempenho de vendas</h2><p>Receita aprovada por data local da unidade.</p></div><span>BRL</span></header><div className="analytics-bars">{(data.dailyOrders || []).map((x: any) => <div key={`${x.store_id}-${x.metric_date}`} style={{ height: `${Math.max(4, value(x.revenue_cents) / max * 100)}%` }}><b>{money.format(value(x.revenue_cents) / 100)}</b><small>{new Date(`${x.metric_date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</small></div>)}</div>{!data.dailyOrders?.length && <p className="analytics-empty">Sincronize a plataforma para gerar a série histórica.</p>}</article>
        <article className="analytics-card"><header><div><small>CLIENTE 360</small><h2>Relacionamento</h2></div><span>{data.customers?.length || 0}</span></header>{(data.customers || []).slice(0, 5).map((x: any) => <div className="analytics-row" key={x.customer_id}><div><b>{x.pseudonym || `Cliente ${String(x.customer_id).slice(0, 8)}`}</b><small>{x.order_count || 0} pedidos · última compra {x.last_order_at ? dateLabel(x.last_order_at) : "—"}</small></div><strong>{money.format(value(x.revenue_cents) / 100)}</strong></div>)}{!data.customers?.length && <p className="analytics-empty">A visão unificada será formada no próximo sync.</p>}</article>
        <article className="analytics-card"><header><div><small>ORGANIZAÇÃO 360</small><h2>Saúde e adoção</h2></div><span>{data.organizations?.length || 0}</span></header>{(data.organizations || []).slice(0, 5).map((x: any) => <div className="analytics-row" key={x.organization_id}><div><b>Conta {String(x.organization_id).slice(0, 8)}</b><small>Risco {x.churn_risk || "sem classificação"} · MRR {money.format(value(x.mrr_cents) / 100)}</small></div><strong>{x.health_score == null ? "—" : `${Math.round(x.health_score)}%`}</strong></div>)}{!data.organizations?.length && <p className="analytics-empty">Sem organizações consolidadas.</p>}</article>
      </section>
    </>}

    {tab === "catalog" && <section className="analytics-grid"><article className="analytics-card analytics-wide"><header><div><small>SEMANTIC LAYER</small><h2>Catálogo de métricas certificadas</h2><p>Uma definição única para produto, financeiro, operações e direção.</p></div><span>{data.metrics?.length || 0} métricas</span></header><div className="analytics-table"><table><thead><tr><th>Métrica</th><th>Fonte oficial</th><th>Definição</th><th>Unidade</th><th>Atualização</th></tr></thead><tbody>{(data.metrics || []).map((x: any) => <tr key={x.metric_key}><td><b>{x.name}</b><small>{x.metric_key}</small></td><td>{x.source_of_truth}</td><td>{x.description}</td><td>{x.unit}</td><td>{x.refresh_frequency}</td></tr>)}</tbody></table></div></article><article className="analytics-card"><header><div><small>DISCOVERY</small><h2>Datasets</h2></div></header>{(data.datasets || []).map((x: any) => <div className="analytics-row" key={x.dataset_key}><div><b>{x.name}</b><small>{x.domain} · {x.certified ? "certificado" : "em validação"}</small></div><span>{x.status}</span></div>)}</article><article className="analytics-card"><header><div><small>CONTRATOS</small><h2>Schema contracts</h2></div></header>{(data.contracts || []).map((x: any) => <div className="analytics-row" key={x.contract_key}><div><b>{x.contract_key}</b><small>Versão {x.version}</small></div><span>{x.status}</span></div>)}</article></section>}

    {tab === "quality" && <section className="analytics-grid"><article className="analytics-card"><header><div><small>DATA QUALITY</small><h2>Verificações recentes</h2></div><span>{data.quality?.length || 0}</span></header>{(data.quality || []).slice(0, 12).map((x: any) => <div className="analytics-row" key={x.id}><div><b>{x.analytics_quality_rules?.rule_key || "regra"}</b><small>{x.rows_checked || 0} linhas · {x.invalid_rows || 0} inválidas</small></div><span className={x.status}>{x.status}</span></div>)}</article><article className="analytics-card"><header><div><small>QUARENTENA</small><h2>Registros isolados</h2></div><span>{data.quarantine?.length || 0}</span></header>{(data.quarantine || []).slice(0, 12).map((x: any) => <div className="analytics-row" key={x.id}><div><b>{x.source}</b><small>{(x.reason_codes || []).join(", ")}</small></div><span>{dateLabel(x.created_at)}</span></div>)}{!data.quarantine?.length && <p className="analytics-empty">Nenhum registro em quarentena.</p>}</article><article className="analytics-card analytics-wide"><header><div><small>LINEAGE</small><h2>Origem → transformação → destino</h2></div></header>{(data.lineage || []).map((x: any) => <div className="analytics-lineage" key={x.id}><b>{x.source_name}</b><span>→</span><em>{x.transformation_name}</em><span>→</span><b>{x.target_dataset}</b></div>)}</article></section>}

    {tab === "dashboards" && <section className="analytics-grid"><article className="analytics-card"><header><div><small>SELF-SERVICE BI</small><h2>Dashboards salvos</h2><p>Widgets usam apenas métricas e dimensões aprovadas.</p></div><button onClick={() => action("dashboard", { name: "Novo dashboard", description: "Criado no Centro de Analytics" })} disabled={Boolean(busy)}>Criar dashboard</button></header>{(data.dashboards || []).map((x: any) => <div className="analytics-row" key={x.id}><div><b>{x.name}</b><small>{x.description || "Sem descrição"}</small></div><span>{x.shared_internally ? "Compartilhado" : "Privado"}</span></div>)}</article><article className="analytics-card"><header><div><small>REPORT CENTER</small><h2>Execuções e entregas</h2></div><button onClick={() => action("export", { dataset_key: "daily_orders", format: "csv", filters: { from: dates.from, to: dates.to } })} disabled={Boolean(busy)}>Exportar CSV</button></header>{(data.reports || []).slice(0, 8).map((x: any) => <div className="analytics-row" key={x.id}><div><b>{x.status}</b><small>{dateLabel(x.created_at)}</small></div><span>{x.format || "relatório"}</span></div>)}{!data.reports?.length && <p className="analytics-empty">Nenhum relatório executado.</p>}</article></section>}

    {tab === "operations" && <section className="analytics-grid"><article className="analytics-card"><header><div><small>PIPELINES</small><h2>Sincronização incremental</h2><p>Checkpoint, idempotência, atraso tolerado e reprocessamento controlado.</p></div>{internal && <button onClick={() => action("sync")} disabled={Boolean(busy)}>{busy === "sync" ? "Sincronizando…" : "Sincronizar agora"}</button>}</header>{(data.runs || []).slice(0, 10).map((x: any) => <div className="analytics-row" key={x.id}><div><b>{x.pipeline_key}</b><small>{x.rows_loaded || 0} carregados · {dateLabel(x.started_at)}</small></div><span className={x.status}>{x.status}</span></div>)}</article><article className="analytics-card"><header><div><small>FRESHNESS</small><h2>Checkpoints</h2></div><span>{data.checkpoints?.length || 0}</span></header>{(data.checkpoints || []).slice(0, 14).map((x: any) => <div className="analytics-row" key={x.source}><div><b>{x.source}</b><small>{dateLabel(x.last_synced_at)}</small></div><span>{x.lag_seconds || 0}s</span></div>)}</article><article className="analytics-card"><header><div><small>BACKFILL</small><h2>Reprocessamento seguro</h2></div>{internal && <button onClick={() => action("backfill_preview", { from: dates.from, to: dates.to })} disabled={Boolean(busy)}>Simular</button>}</header>{(data.backfills || []).slice(0, 8).map((x: any) => <div className="analytics-row" key={x.id}><div><b>{x.dataset_key}</b><small>{x.date_from} → {x.date_to}</small></div><span>{x.status}</span></div>)}{!data.backfills?.length && <p className="analytics-empty">Nenhum backfill solicitado.</p>}</article><article className="analytics-card"><header><div><small>CUSTO</small><h2>Uso da plataforma</h2></div></header><div className="analytics-cost"><strong>{integer.format((data.cost || []).reduce((n: number, x: any) => n + value(x.rows_scanned), 0))}</strong><span>linhas lidas</span><strong>{money.format((data.cost || []).reduce((n: number, x: any) => n + value(x.estimated_cost_cents), 0) / 100)}</strong><span>custo estimado</span></div></article></section>}
    <p className="analytics-disclaimer">Dados analíticos respeitam organização, unidade e permissões. Informações pessoais são minimizadas; exportações e ações sensíveis ficam auditadas.</p>
  </div>;
}
