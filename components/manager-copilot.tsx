"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { managerPeriodOptions } from "@/lib/intelligence/periods";
import type { CopilotAnswer, ManagerPeriodKey, ManagerPeriodRange, ManagerSnapshot } from "@/lib/intelligence/types";
import type { CopilotActionHistory, CopilotActionProposal } from "@/lib/intelligence/action-types";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const integer = new Intl.NumberFormat("pt-BR");
const brl = (value: unknown) => money.format(Number(value || 0) / 100);
const n = (value: unknown) => integer.format(Number(value || 0));
const pct = (value: unknown) => `${Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const tabs = [
  ["geral", "Visão geral"], ["pergunte", "Pergunte ao MasterApp"], ["alertas", "Alertas"], ["vendas", "Vendas"],
  ["operacao", "Operação"], ["atendimento", "Atendimento"], ["produtos", "Produtos"], ["campanhas", "Campanhas"],
  ["unidades", "Unidades"], ["equipe", "Equipe"], ["insights", "Insights"], ["aprovacoes", "Aprovações"], ["historico", "Histórico de ações"],
] as const;
const quickQuestions = ["Como estão minhas vendas hoje?", "Tenho algum problema agora?", "Qual unidade está melhor?", "Quais produtos mais venderam?", "Como está o atendimento?", "Minha campanha funcionou?"];
const categoryLabels: Record<string, string> = { sales: "Vendas", support: "Atendimento", payments: "Pagamentos", financial: "Financeiro", delivery: "Delivery", inventory: "Estoque", campaigns: "Campanhas", whatsapp: "WhatsApp", ai: "IA" };

function Metric({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: string }) {
  return <article className={`manager-metric ${tone || ""}`}><small>{label}</small><strong>{value}</strong>{note && <span>{note}</span>}</article>;
}

function Delta({ value, label }: { value: number | null | undefined; label: string }) {
  if (value == null) return <span className="manager-delta neutral">Sem base para comparar</span>;
  return <span className={`manager-delta ${value >= 0 ? "positive" : "negative"}`}>{value >= 0 ? "↑" : "↓"} {pct(Math.abs(value))} {label}</span>;
}

function SimpleBars({ rows, labelKey, valueKey, formatter = n }: { rows: Array<Record<string, unknown>>; labelKey: string; valueKey: string; formatter?: (value: unknown) => string }) {
  const max = Math.max(1, ...rows.map(row => Number(row[valueKey] || 0)));
  return <div className="manager-bars">{rows.map((row, index) => <div key={`${String(row[labelKey])}-${index}`}><header><b>{String(row[labelKey] || "Não informado")}</b><span>{formatter(row[valueKey])}</span></header><i><em style={{ width: `${Math.max(2, Number(row[valueKey] || 0) / max * 100)}%` }} /></i></div>)}{!rows.length && <p className="manager-empty">Sem dados reais neste período.</p>}</div>;
}

function InsightCard({ level = "informative", title, text, detail, href, linkLabel }: { level?: string; title: string; text: string; detail?: string; href?: string; linkLabel?: string }) {
  return <article className={`manager-insight ${level}`}><small>{level === "critical" ? "CRÍTICO" : level === "attention" ? "ATENÇÃO" : "INSIGHT"}</small><h3>{title}</h3><p>{text}</p>{detail && <span>{detail}</span>}{href && <Link href={href}>{linkLabel || "Abrir detalhes"} →</Link>}</article>;
}

function ActionCard({ proposal, result, phrase, onPhrase, onAction, busy }: { proposal: CopilotActionProposal; result?: string; phrase: string; onPhrase: (value: string) => void; onAction: (operation: "confirm" | "cancel") => void; busy: boolean }) {
  const expires = new Date(proposal.expires_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return <section className={`manager-action-card risk-${proposal.risk_level.toLowerCase()}`}><header><div><small>AÇÃO SUGERIDA · RISCO {proposal.risk_level}</small><h3>{proposal.preview.title}</h3></div><span>{proposal.preview.affected_count} afetado(s)</span></header><div className="manager-action-impact"><b>Impacto</b><p>{proposal.preview.impact}</p></div>{proposal.preview.items?.length ? <details><summary>Ver itens afetados</summary>{proposal.preview.items.map((item, index) => <p key={String(item.id || index)}>{String(item.name || item.id || "Item")}</p>)}</details> : null}<p className="manager-action-expiry">Confirmação válida até {expires}. O estado será verificado novamente antes da execução.</p>{proposal.required_approvals > 1 && <p className="manager-action-warning">Esta ação exige {proposal.required_approvals} responsáveis autorizados.</p>}{proposal.confirmation_phrase && <label>Digite <b>{proposal.confirmation_phrase}</b><input value={phrase} onChange={event => onPhrase(event.target.value)} /></label>}{result ? <strong className="manager-action-result">{result}</strong> : <div className="manager-action-buttons"><button disabled={busy || proposal.preview.already_applied} onClick={() => onAction("confirm")}>Confirmar alteração</button><button className="secondary" disabled={busy} onClick={() => onAction("cancel")}>Cancelar</button></div>}</section>;
}

export function ManagerCopilot({ establishmentId, establishmentName, initialSnapshot, period, initialTab = "geral", allUnits = false, customStart, customEnd }: { establishmentId: string; establishmentName: string; initialSnapshot: ManagerSnapshot; period: ManagerPeriodRange; initialTab?: string; allUnits?: boolean; customStart?: string; customEnd?: string }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [tab, setTab] = useState(tabs.some(([key]) => key === initialTab) ? initialTab : "geral");
  const [question, setQuestion] = useState(""); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState("");
  const [messages, setMessages] = useState<Array<{ question: string; answer: CopilotAnswer }>>([]);
  const [history, setHistory] = useState<CopilotActionHistory | null>(null);
  const [actionResults, setActionResults] = useState<Record<string, string>>({});
  const [confirmationPhrases, setConfirmationPhrases] = useState<Record<string, string>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<Record<string, unknown>>({ ...initialSnapshot.settings });
  const sales = snapshot.sales; const comparison = snapshot.comparison; const support = snapshot.support; const delivery = snapshot.delivery as Record<string, unknown>; const ai = snapshot.ai;
  const enabledCategories = Array.isArray(settings.enabled_categories) ? settings.enabled_categories as string[] : [];

  const peak = useMemo(() => [...(snapshot.hourly || [])].sort((a, b) => Number(b.orders || 0) - Number(a.orders || 0))[0], [snapshot.hourly]);
  const bestUnit = snapshot.units?.[0]; const topProduct = snapshot.products?.[0];
  const periodQuery = `period=${period.key}${allUnits ? "&all=1" : ""}${customStart ? `&start=${customStart}` : ""}${customEnd ? `&end=${customEnd}` : ""}`;

  async function ask(selected?: string) {
    const text = (selected || question).trim(); if (!text || busy) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/intelligence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ establishment_id: establishmentId, question: text, period: period.key, custom_start: customStart, custom_end: customEnd, all_units: allUnits }) });
      const payload = await response.json() as { answer?: CopilotAnswer; snapshot?: ManagerSnapshot; error?: string };
      if (!response.ok || !payload.answer) throw new Error(payload.error || "Não foi possível consultar o Copiloto.");
      setMessages(current => [...current, { question: text, answer: payload.answer! }]); if (payload.snapshot) setSnapshot(payload.snapshot); setQuestion(""); setTab("pergunte");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível consultar o Copiloto."); }
    finally { setBusy(false); }
  }

  async function feedback(answer: CopilotAnswer, useful: boolean) {
    if (!answer.queryAuditId) return;
    await fetch("/api/intelligence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "feedback", establishment_id: establishmentId, query_audit_id: answer.queryAuditId, useful }) });
    setNotice("Obrigado. Seu feedback foi registrado para calibrar a apresentação.");
  }

  async function loadHistory() {
    const response = await fetch("/api/intelligence/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "list", establishment_id: establishmentId }) });
    const payload = await response.json() as { history?: CopilotActionHistory; error?: string };
    if (!response.ok) { setNotice(payload.error || "Não foi possível abrir o histórico."); return; }
    setHistory(payload.history || null);
  }

  async function actionRequest(proposal: CopilotActionProposal, operation: "confirm" | "cancel") {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/intelligence/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation, establishment_id: establishmentId, action_id: proposal.id, confirmation_token: proposal.confirmation_token, confirmation_text: confirmationPhrases[proposal.id] || "" }) });
      const payload = await response.json() as { result?: { message?: string }; error?: string };
      if (!response.ok) throw new Error(payload.error || "A alteração não foi concluída.");
      const message = payload.result?.message || (operation === "cancel" ? "Ação cancelada." : "Alteração concluída.");
      setActionResults(current => ({ ...current, [proposal.id]: message })); setNotice(message); await loadHistory();
    } catch (error) { setNotice(error instanceof Error ? error.message : "A alteração não foi concluída."); } finally { setBusy(false); }
  }

  async function undoAction(actionId: string) {
    setBusy(true);
    try {
      const response = await fetch("/api/intelligence/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "undo", establishment_id: establishmentId, action_id: actionId }) });
      const payload = await response.json() as { result?: { message?: string }; error?: string }; if (!response.ok) throw new Error(payload.error || "Não foi possível desfazer.");
      setNotice(payload.result?.message || "Alteração desfeita."); await loadHistory();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível desfazer."); } finally { setBusy(false); }
  }

  async function saveSettings() {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/intelligence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "settings", establishment_id: establishmentId, settings }) });
      const payload = await response.json() as { settings?: Record<string, unknown>; error?: string }; if (!response.ok) throw new Error(payload.error || "Não foi possível salvar.");
      if (payload.settings) setSettings(payload.settings); setSettingsOpen(false); setNotice("Alertas atualizados. As decisões continuam sob seu controle.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível salvar."); } finally { setBusy(false); }
  }

  function submitCustom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); const start = String(data.get("start") || ""); const end = String(data.get("end") || "");
    if (start && end) window.location.href = `/painel/inteligencia?period=custom&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}${allUnits ? "&all=1" : ""}`;
  }

  return <div className="manager-copilot">
    {notice && <div className="manager-notice" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Fechar">×</button></div>}
    <section className="manager-toolbar">
      <nav aria-label="Período da inteligência">{managerPeriodOptions.filter(item => item.key !== "custom").map(item => <Link key={item.key} className={period.key === item.key ? "active" : ""} href={`/painel/inteligencia?period=${item.key}${allUnits ? "&all=1" : ""}`}>{item.label}</Link>)}</nav>
      <form onSubmit={submitCustom}><input aria-label="Início" name="start" type="date" defaultValue={customStart} /><span>até</span><input aria-label="Fim" name="end" type="date" defaultValue={customEnd} /><button>Aplicar</button></form>
      {snapshot.permissions.all_units && <Link className={`manager-scope-toggle ${allUnits ? "active" : ""}`} href={`/painel/inteligencia?${periodQuery.replace(/&?all=1/, "")}${allUnits ? "" : "&all=1"}`}>{allUnits ? "Todas as unidades" : "Somente esta unidade"}</Link>}
    </section>
    <nav className="manager-tabs" aria-label="Áreas de inteligência">{tabs.map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => { setTab(key); if (key === "aprovacoes" || key === "historico") void loadHistory(); }}>{label}</button>)}</nav>

    {tab === "geral" && <>
      <section className="manager-summary-hero"><div><small>RESUMO DE HOJE · DADOS REAIS</small><h2>{period.label} em {establishmentName}</h2><p>Consolidação operacional com a mesma regra de receita do dashboard. Atualizado em {new Date(snapshot.generated_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.</p></div><button onClick={() => setTab("pergunte")}>Pergunte ao MasterApp →</button></section>
      <section className="manager-metrics-grid"><Metric label="FATURAMENTO" value={brl(sales.revenue_cents)} note={`Ticket ${brl(sales.average_ticket_cents)}`} /><Metric label="PEDIDOS APROVADOS" value={n(sales.approved_orders)} note={`${n(sales.pending_orders)} pendente(s)`} /><Metric label="CANCELAMENTOS" value={n(sales.cancelled_orders)} note={pct(sales.cancelled_percent)} tone={Number(sales.cancelled_percent) >= 15 ? "warning" : ""} /><Metric label="WHATSAPP" value={n(sales.whatsapp_orders)} note={`${n(ai.orders)} pedido(s) pela IA`} /><Metric label="ENTREGAS" value={n(delivery.delivered)} note={`${n(delivery.active)} em andamento`} /><Metric label="CLIENTES" value={n(snapshot.crm.customers)} note={`${n(snapshot.crm.new_customers)} novo(s)`} /></section>
      <section className="manager-comparison"><div><small>COMPARAÇÃO JUSTA</small><h2>{period.comparisonLabel}</h2><p>{period.sameHour ? "Dia incompleto comparado até o mesmo horário." : "Períodos equivalentes, sem misturar dia parcial com dia completo."}</p></div><Delta value={sales.revenue_delta_percent} label="em faturamento" /><Delta value={sales.orders_delta_percent} label="em pedidos" /></section>
      <section className="manager-overview-grid"><div className="manager-panel"><header><small>PICOS</small><h2>Ritmo por hora</h2></header><SimpleBars rows={(snapshot.hourly || []).map(row => ({ ...row, label: `${String(row.hour).padStart(2, "0")}h` }))} labelKey="label" valueKey="orders" /></div><div className="manager-panel"><header><small>ALERTAS</small><h2>O que pede atenção</h2></header><div className="manager-alert-list">{snapshot.alerts.slice(0, 4).map(alert => <InsightCard key={alert.id} level={alert.level} title={alert.title} text={alert.message} href={alert.action_href} linkLabel={alert.action_label} />)}{!snapshot.alerts.length && <InsightCard title="Operação estável" text="Nenhuma regra encontrou anomalia com amostra suficiente." />}</div></div></section>
    </>}

    {tab === "pergunte" && <section className="manager-chat-layout"><div className="manager-chat-panel"><header><small>COPILOTO INTERNO</small><h2>Pergunte ou proponha uma ação</h2><p>Toda mudança passa por prévia, confirmação vinculada à sua sessão, nova validação e auditoria.</p></header><div className="manager-chat-history">{!messages.length && <div className="manager-chat-empty"><span>✦</span><h3>O que você quer entender ou ajustar?</h3><p>Ex.: “Desative a Coca-Cola 350ml” ou “Pause o delivery por 30 minutos”.</p></div>}{messages.map((message, index) => <div className="manager-chat-turn" key={index}><p className="manager-question">{message.question}</p><article className="manager-answer"><small>{message.answer.title}</small><p>{message.answer.answer}</p>{message.answer.facts.length > 0 && <ul>{message.answer.facts.map(fact => <li key={fact}><b>Fato:</b> {fact}</li>)}</ul>}{message.answer.hypotheses.map(hypothesis => <p className="manager-hypothesis" key={hypothesis}><b>Hipótese:</b> {hypothesis}</p>)}{message.answer.recommendations.map(item => <p className="manager-recommendation" key={item}><b>Sugestão:</b> {item}</p>)}{message.answer.action && <Link href={message.answer.action.href}>{message.answer.action.label} →</Link>}{message.answer.actionProposal && <ActionCard proposal={message.answer.actionProposal} result={actionResults[message.answer.actionProposal.id]} phrase={confirmationPhrases[message.answer.actionProposal.id] || ""} onPhrase={value => setConfirmationPhrases(current => ({ ...current, [message.answer.actionProposal!.id]: value }))} onAction={operation => actionRequest(message.answer.actionProposal!, operation)} busy={busy} />}<footer><span>Fontes: {message.answer.sources.join(", ")}</span><div>Esse insight foi útil? <button onClick={() => feedback(message.answer, true)}>Sim</button><button onClick={() => feedback(message.answer, false)}>Não</button></div></footer></article></div>)}</div><form className="manager-chat-form" onSubmit={event => { event.preventDefault(); ask(); }}><textarea value={question} onChange={event => setQuestion(event.target.value)} placeholder="Ex.: Desative a Coca-Cola 350ml" maxLength={1000} /><button disabled={busy || !question.trim()}>{busy ? "Verificando…" : "Enviar →"}</button></form></div><aside className="manager-quick-questions"><small>PERGUNTAS RÁPIDAS</small>{quickQuestions.map(item => <button key={item} onClick={() => ask(item)}>{item}<span>→</span></button>)}<div><b>Controle humano obrigatório</b><p>Preço, pagamentos, reembolsos, credenciais, plano, exclusões e administradores permanecem bloqueados no Copiloto.</p></div></aside></section>}

    {tab === "alertas" && <section className="manager-section"><header className="manager-section-head"><div><small>CENTRAL DE ALERTAS</small><h2>Riscos e anomalias</h2><p>Regras determinísticas detectam fatos; a explicação adiciona contexto sem inventar causalidade.</p></div>{snapshot.permissions.configure_alerts && <button onClick={() => setSettingsOpen(value => !value)}>Configurar alertas</button>}</header>{settingsOpen && <div className="manager-settings"><div className="manager-category-grid">{Object.entries(categoryLabels).map(([key, label]) => <label key={key}><input type="checkbox" checked={enabledCategories.includes(key)} onChange={event => setSettings(current => ({ ...current, enabled_categories: event.target.checked ? [...enabledCategories, key] : enabledCategories.filter(value => value !== key) }))} />{label}</label>)}</div><label>Sensibilidade<select value={String(settings.sensitivity || "balanced")} onChange={event => setSettings(current => ({ ...current, sensitivity: event.target.value }))}><option value="conservative">Conservadora</option><option value="balanced">Equilibrada</option><option value="sensitive">Sensível</option></select></label><label>Amostra mínima<input type="number" min="3" max="1000" value={Number(settings.minimum_order_sample || 10)} onChange={event => setSettings(current => ({ ...current, minimum_order_sample: Number(event.target.value) }))} /></label><label><input type="checkbox" checked={Boolean(settings.internal_notifications ?? true)} onChange={event => setSettings(current => ({ ...current, internal_notifications: event.target.checked }))} /> Notificação interna</label><label><input type="checkbox" checked={Boolean(settings.whatsapp_opt_in)} onChange={event => setSettings(current => ({ ...current, whatsapp_opt_in: event.target.checked }))} /> WhatsApp do gestor (opt-in)</label><button disabled={busy} onClick={saveSettings}>Salvar configuração</button></div>}<div className="manager-alert-grid">{snapshot.alerts.map(alert => <InsightCard key={alert.id} level={alert.level} title={alert.title} text={alert.message} href={alert.action_href} linkLabel={alert.action_label} />)}{!snapshot.alerts.length && <InsightCard title="Nenhum alerta relevante" text="Amostras pequenas não geram alarme grave. Continue acompanhando o painel." />}</div></section>}

    {tab === "vendas" && <section className="manager-section"><header className="manager-section-head"><div><small>VENDAS</small><h2>Receita, pedidos e pagamentos</h2></div></header><div className="manager-metrics-grid"><Metric label="RECEITA APROVADA" value={brl(sales.revenue_cents)} /><Metric label="TICKET MÉDIO" value={brl(sales.average_ticket_cents)} /><Metric label="APROVAÇÃO" value={pct(sales.approved_percent)} /><Metric label="PEDIDOS" value={n(sales.total_orders)} /><Metric label="PERÍODO ANTERIOR" value={brl(comparison.revenue_cents)} /><Metric label="MÉDIA 28 DIAS" value={brl(snapshot.baseline.average_revenue_cents)} /></div><div className="manager-three"><div className="manager-panel"><h3>Vendas por hora</h3><SimpleBars rows={(snapshot.hourly || []).map(row => ({ ...row, label: `${String(row.hour).padStart(2, "0")}h` }))} labelKey="label" valueKey="revenue_cents" formatter={brl} /></div><div className="manager-panel"><h3>Formas de pagamento</h3><SimpleBars rows={snapshot.payments} labelKey="method" valueKey="orders" /></div><InsightCard title="Previsão identificada" text={snapshot.forecast.revenue_cents == null ? "A projeção aparece quando há período parcial e histórico suficiente." : `Estimativa de fechamento: ${brl(snapshot.forecast.revenue_cents)}.`} detail="Estimativa baseada no ritmo atual; não é garantia." /></div></section>}

    {tab === "operacao" && <section className="manager-section"><header className="manager-section-head"><div><small>OPERAÇÃO</small><h2>Cozinha, delivery e capacidade</h2></div></header><div className="manager-metrics-grid"><Metric label="ENTREGAS CONCLUÍDAS" value={n(delivery.delivered)} /><Metric label="EM ANDAMENTO" value={n(delivery.active)} /><Metric label="TEMPO MÉDIO" value={`${Number(delivery.average_minutes || 0).toLocaleString("pt-BR")} min`} /><Metric label="ATRASADAS" value={n(delivery.late)} tone={Number(delivery.late) >= 3 ? "warning" : ""} /><Metric label="ESTOQUE CRÍTICO" value={n(snapshot.inventory.critical_count)} /><Metric label="PICO" value={peak ? `${String(peak.hour).padStart(2, "0")}h` : "—"} /></div><div className="manager-two"><div className="manager-panel"><h3>Regiões de entrega</h3><SimpleBars rows={(delivery.regions || []) as Array<Record<string, unknown>>} labelKey="region" valueKey="orders" /></div><div className="manager-panel"><h3>Estoque próximo do mínimo</h3><SimpleBars rows={(snapshot.inventory.items || []).map(item => ({ ...item, label: `${item.name} · mínimo ${item.minimum}` }))} labelKey="label" valueKey="balance" /></div></div></section>}

    {tab === "atendimento" && <section className="manager-section"><header className="manager-section-head"><div><small>ATENDIMENTO</small><h2>Fila, SLA e experiência</h2></div></header><div className="manager-metrics-grid"><Metric label="AGUARDANDO" value={n(support.waiting)} tone={Number(support.waiting) >= 10 ? "warning" : ""} /><Metric label="EM ATENDIMENTO" value={n(support.in_progress)} /><Metric label="PRIMEIRA RESPOSTA" value={`${Number(support.average_first_response_minutes || 0).toLocaleString("pt-BR")} min`} /><Metric label="RESOLUÇÃO" value={`${Number(support.average_resolution_minutes || 0).toLocaleString("pt-BR")} min`} /><Metric label="SLA ULTRAPASSADO" value={n(support.sla_breached)} /><Metric label="SATISFAÇÃO" value={support.satisfaction ? `${Number(support.satisfaction).toLocaleString("pt-BR")}/5` : "—"} /></div><InsightCard title="Leitura responsável da equipe" text="Atendimentos, SLA, satisfação e transferências devem ser avaliados juntos. O MasterApp não cria ranking simplista apenas por velocidade." href="/painel/whatsapp/supervisao" linkLabel="Abrir supervisão" /></section>}

    {tab === "produtos" && <section className="manager-section"><header className="manager-section-head"><div><small>PRODUTOS</small><h2>Saída, receita e adicionais</h2></div></header><div className="manager-table"><div className="head"><span>Produto</span><span>Quantidade</span><span>Receita</span><span>Pedidos</span><span>Adicionais</span><span>Cancelados</span></div>{snapshot.products.map(item => <div key={`${item.product_id}-${item.name}`}><b>{String(item.name)}</b><span>{n(item.quantity)}</span><span>{brl(item.revenue_cents)}</span><span>{n(item.orders)}</span><span>{pct(item.addon_rate_percent)}</span><span>{n(item.cancelled_quantity)}</span></div>)}</div>{topProduct && <InsightCard title="Destaque do período" text={`${String(topProduct.name)} lidera em quantidade e pode orientar análise de estoque e combinações frequentes.`} detail="Nenhuma promoção será criada automaticamente." />}</section>}

    {tab === "campanhas" && <section className="manager-section"><header className="manager-section-head"><div><small>CAMPANHAS</small><h2>Entrega, conversão e receita atribuída</h2></div></header><div className="manager-table campaigns"><div className="head"><span>Campanha</span><span>Enviadas</span><span>Entregues</span><span>Pedidos</span><span>Conversão</span><span>Receita</span></div>{snapshot.campaigns.map(item => <div key={String(item.id)}><b>{String(item.name)}</b><span>{n(item.sent)}</span><span>{n(item.delivered)}</span><span>{n(item.orders)}</span><span>{pct(item.conversion_percent)}</span><span>{brl(item.revenue_cents)}</span></div>)}</div>{!snapshot.campaigns.length && <p className="manager-empty">Nenhuma campanha com atividade neste escopo.</p>}</section>}

    {tab === "unidades" && <section className="manager-section"><header className="manager-section-head"><div><small>BENCHMARK INTERNO</small><h2>Unidades da própria organização</h2><p>Nenhuma comparação com concorrentes é feita.</p></div></header><div className="manager-unit-grid">{snapshot.units.map((unit, index) => <article key={String(unit.id)}><header><span>{index + 1}</span><b>{String(unit.name)}</b><em className={unit.open ? "open" : "closed"}>{unit.open ? "Aberta" : "Fechada"}</em></header><strong>{brl(unit.revenue_cents)}</strong><p>{n(unit.orders)} pedidos · ticket {brl(unit.average_ticket_cents)}</p><small>Capacidade: {String(unit.capacity || "normal")}</small></article>)}</div>{bestUnit && <InsightCard title="Unidade em destaque" text={`${String(bestUnit.name)} lidera o faturamento no período. Isso é desempenho interno, não prova causalidade nem qualidade isoladamente.`} />}</section>}

    {tab === "equipe" && <section className="manager-section"><header className="manager-section-head"><div><small>EQUIPE</small><h2>Carga e qualidade do atendimento</h2></div></header><div className="manager-metrics-grid"><Metric label="ATENDENTES ATIVOS" value={n(support.active_agents)} /><Metric label="CONVERSAS AGUARDANDO" value={n(support.waiting)} /><Metric label="EM ATENDIMENTO" value={n(support.in_progress)} /><Metric label="SATISFAÇÃO" value={support.satisfaction ? `${Number(support.satisfaction).toLocaleString("pt-BR")}/5` : "—"} /></div><InsightCard title="Decisão continua com o gestor" text="O Copiloto pode sugerir reforço de equipe quando a fila cresce, mas não muda escala, função ou acesso automaticamente." href="/painel/equipe" linkLabel="Abrir equipe" /></section>}

    {tab === "insights" && <section className="manager-section"><header className="manager-section-head"><div><small>INSIGHTS</small><h2>Leituras acionáveis, sem execução automática</h2></div></header><div className="manager-alert-grid"><InsightCard title="Vendas" text={periodComparisonText(sales)} detail={`Base histórica: ${n(snapshot.baseline.days)} dia(s).`} href="/painel/inteligencia?tab=vendas" /><InsightCard title="Horário de pico" text={peak ? `Maior volume às ${String(peak.hour).padStart(2, "0")}h, com ${n(peak.orders)} pedido(s).` : "Ainda não há amostra horária."} /><InsightCard title="Produto líder" text={topProduct ? `${String(topProduct.name)} vendeu ${n(topProduct.quantity)} unidade(s).` : "Ainda não há vendas de produtos."} href="/painel/inteligencia?tab=produtos" /><InsightCard title="Clientes" text={`${n(snapshot.crm.recurring_customers)} recorrente(s), ${n(snapshot.crm.new_customers)} novo(s) e ${n(snapshot.crm.inactive_customers)} inativo(s).`} href="/painel/crm" /><InsightCard title="IA" text={`${n(ai.orders)} pedido(s) e ${brl(ai.revenue_cents)} de receita registrada, com fallback de ${pct(ai.fallback_percent)}.`} href="/painel/atendente-ia" /><InsightCard title="Próximo passo seguro" text="Revise o detalhe correspondente antes de alterar preço, campanha, estoque, pagamento ou equipe." /></div></section>}

    {tab === "aprovacoes" && <section className="manager-section"><header className="manager-section-head"><div><small>CONTROLE HUMANO</small><h2>Aprovações pendentes</h2><p>A confirmação não é aceita fora do cartão correto e expira automaticamente.</p></div></header><div className="manager-action-grid">{history?.actions.filter(item => ["pending_confirmation", "pending_approval"].includes(item.status)).map(item => <article className="manager-history-card" key={item.id}><small>{item.risk_level} · {item.status === "pending_approval" ? "aguardando outro responsável" : "aguardando confirmação"}</small><h3>{String(item.preview.title || item.action_type)}</h3><p>{String(item.preview.impact || "Revise o impacto antes de aprovar.")}</p><button onClick={() => setTab("pergunte")}>Revisar na conversa</button></article>)}{history && !history.actions.some(item => ["pending_confirmation", "pending_approval"].includes(item.status)) && <p className="manager-empty">Nenhuma aprovação pendente.</p>}</div><section className="manager-playbook"><small>PLAYBOOK SUGESTIVO</small><h3>Pico de pedidos</h3><p>O Copiloto pode propor aumentar o prazo, revisar a fila e pausar campanhas. Cada mudança continua sendo apresentada antes da confirmação.</p><div><button onClick={() => ask("Coloque a previsão de entrega em 60 minutos")}>Propor prazo de 60 min</button><Link href="/painel/whatsapp/supervisao">Ver fila</Link></div></section></section>}

    {tab === "historico" && <section className="manager-section"><header className="manager-section-head"><div><small>AUDITORIA OPERACIONAL</small><h2>Histórico de ações</h2><p>Solicitação, confirmação, execução, falha e desfazer ficam registrados.</p></div></header>{history && <div className="manager-metrics-grid"><Metric label="SUGERIDAS" value={n(history.metrics.suggested)} /><Metric label="CONFIRMADAS" value={n(history.metrics.confirmed)} /><Metric label="EXECUTADAS" value={n(history.metrics.executed)} /><Metric label="CANCELADAS" value={n(history.metrics.cancelled)} /><Metric label="FALHAS" value={n(history.metrics.failed)} /><Metric label="DESFEITAS" value={n(history.metrics.undone)} /></div>}<div className="manager-history-list">{history?.actions.map(item => <article className="manager-history-card" key={item.id}><div><small>{new Date(item.created_at).toLocaleString("pt-BR")} · {item.risk_level}</small><h3>{String(item.preview.title || item.action_type)}</h3><p>{String(item.preview.impact || "")}</p></div><span className={`status-${item.status}`}>{item.status.replaceAll("_", " ")}</span>{item.status === "executed" && item.undo_expires_at && new Date(item.undo_expires_at) > new Date() && <button disabled={busy} onClick={() => undoAction(item.id)}>Desfazer</button>}</article>)}{!history?.actions.length && <p className="manager-empty">Nenhuma ação registrada.</p>}</div>{history?.temporary.length ? <div className="manager-panel"><h3>Alterações temporárias ativas</h3>{history.temporary.map(item => <p key={item.id}><b>{item.operation_type}</b> · restauração automática em {new Date(item.restore_at).toLocaleString("pt-BR")}</p>)}</div> : null}</section>}
  </div>;
}

function periodComparisonText(sales: Record<string, number>) {
  const revenue = sales.revenue_delta_percent; const orders = sales.orders_delta_percent;
  if (revenue == null && orders == null) return "Ainda não há base comparável suficiente.";
  return `Faturamento ${Number(revenue) >= 0 ? "subiu" : "caiu"} ${pct(Math.abs(Number(revenue || 0)))} e pedidos ${Number(orders) >= 0 ? "subiram" : "caíram"} ${pct(Math.abs(Number(orders || 0)))}.`;
}
