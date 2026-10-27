"use client";

import { FormEvent, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Policy = { id: string; payout_model: string; per_delivery_cents: number; daily_rate_cents: number; monthly_salary_cents: number; commission_basis_points: number; distance_rates: { min_meters: number; max_meters: number; amount_cents: number }[]; effective_from: string };
type DayEntry = { id: number; type: string; amount_cents: number; reason: string };
type DayDelivery = { order_number: number; order_value_cents: number; customer_fee_cents: number; driver_payout_cents: number };
type DriverDay = { date: string; deliveries: DayDelivery[]; entries: DayEntry[]; total_cents: number };
type FinancialDriver = { driver_profile_id: string; name: string; active: boolean; payment_cycle: string; policy: Policy | null; deliveries_count: number; customer_fees_cents: number; total_payable_cents: number; days: DriverDay[] };
type Closure = { id: string; driver_profile_id: string; period_start: string; period_end: string; deliveries_count: number; customer_fees_cents: number; total_payable_cents: number; status: string };
type Dashboard = { date_from: string; date_to: string; stats: { deliveries: number; order_value_cents: number; customer_fees_cents: number; driver_payouts_cents: number; logistics_margin_cents: number }; drivers: FinancialDriver[]; closures: Closure[] };

const modelLabels: Record<string, string> = { per_delivery: "Por entrega", daily: "Diária", daily_plus_delivery: "Diária + entrega", salary: "Salário", salary_plus_commission: "Salário + comissão", custom: "Personalizado" };
const entryLabels: Record<string, string> = { delivery_payout: "Repasse da entrega", daily_rate: "Diária", salary: "Salário proporcional", commission: "Comissão", bonus: "Bônus", fuel: "Ajuda combustível", rain: "Adicional de chuva", night: "Adicional noturno", adjustment: "Ajuste" };
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const cents = (value: FormDataEntryValue | null) => Math.round(Number(String(value || "0").replace(",", ".")) * 100) || 0;

export function DriverFinancialManager({ establishmentId, initialDashboard }: { establishmentId: string; initialDashboard: Dashboard }) {
  const supabase = useMemo(() => createClient(), []);
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [from, setFrom] = useState(initialDashboard.date_from);
  const [to, setTo] = useState(initialDashboard.date_to);
  const [selectedId, setSelectedId] = useState(initialDashboard.drivers[0]?.driver_profile_id || "");
  const [model, setModel] = useState(initialDashboard.drivers[0]?.policy?.payout_model || "per_delivery");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const selected = dashboard.drivers.find(driver => driver.driver_profile_id === selectedId) || dashboard.drivers[0];

  async function refresh(nextFrom = from, nextTo = to) {
    const { data, error } = await supabase.rpc("get_driver_financial_dashboard", { requested_establishment_id: establishmentId, requested_date_from: nextFrom, requested_date_to: nextTo });
    if (error) return setMessage(error.message);
    setDashboard(data as Dashboard); setMessage("");
  }

  function chooseDriver(id: string) {
    setSelectedId(id);
    setModel(dashboard.drivers.find(driver => driver.driver_profile_id === id)?.policy?.payout_model || "per_delivery");
  }

  async function savePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return; setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const rates = [
      { min_meters: 0, max_meters: 3000, amount_cents: cents(form.get("distance_3")) },
      { min_meters: 3001, max_meters: 6000, amount_cents: cents(form.get("distance_6")) },
      { min_meters: 6001, max_meters: 10000, amount_cents: cents(form.get("distance_10")) },
    ].filter(rate => rate.amount_cents > 0);
    const { error } = await supabase.rpc("save_driver_compensation_policy", {
      requested_driver_profile_id: selected.driver_profile_id, requested_payout_model: model,
      requested_per_delivery_cents: cents(form.get("per_delivery")), requested_daily_rate_cents: cents(form.get("daily_rate")),
      requested_monthly_salary_cents: cents(form.get("salary")), requested_commission_basis_points: Math.round(Number(form.get("commission") || 0) * 100),
      requested_distance_rates: rates, requested_effective_from: String(form.get("effective_from")),
    });
    if (error) setMessage(error.message); else { setMessage("Política de repasse salva com histórico e auditoria."); await refresh(); }
    setBusy(false);
  }

  async function addAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return; setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const { error } = await supabase.rpc("add_driver_financial_adjustment", {
      requested_driver_profile_id: selected.driver_profile_id, requested_entry_type: String(form.get("type")),
      requested_amount_cents: cents(form.get("amount")), requested_direction: String(form.get("direction")),
      requested_reason: String(form.get("reason")), requested_competence_date: String(form.get("date")),
    });
    if (error) setMessage(error.message); else { event.currentTarget.reset(); setMessage("Lançamento registrado. O histórico anterior não foi alterado."); await refresh(); }
    setBusy(false);
  }

  async function closePeriod() {
    if (!selected || !window.confirm(`Fechar ${from} até ${to} para ${selected.name}? Depois, este período não poderá receber novos ajustes.`)) return;
    setBusy(true); setMessage("");
    const { error } = await supabase.rpc("close_driver_financial_period", { requested_driver_profile_id: selected.driver_profile_id, requested_period_start: from, requested_period_end: to, requested_notes: "Fechamento pelo painel administrativo" });
    if (error) setMessage(error.message); else { setMessage("Período fechado e salvo para prestação de contas."); await refresh(); }
    setBusy(false);
  }

  if (!dashboard.drivers.length) return <article className="panel driver-finance"><div className="empty"><b>Cadastre um motoboy para configurar os repasses.</b><span>O financeiro aparecerá aqui sem misturar os valores do caixa.</span></div></article>;

  const p = selected?.policy;
  return <section className="panel driver-finance" id="financeiro-motoboys">
    <header className="team-group-head"><div><small>FINANCEIRO DOS MOTOBOYS</small><h2>Diárias, taxas e fechamento.</h2><p>Taxa do cliente, repasse do motoboy e resultado logístico permanecem separados.</p></div><button type="button" className="button dark" disabled={busy} onClick={closePeriod}>Fechar período</button></header>
    {message && <div className="form-message" role="status">{message}</div>}
    <div className="driver-finance-filters"><div className="field"><label>DE</label><input type="date" value={from} onChange={event => setFrom(event.target.value)} /></div><div className="field"><label>ATÉ</label><input type="date" value={to} onChange={event => setTo(event.target.value)} /></div><button className="button outline" type="button" onClick={() => void refresh()}>Aplicar período</button></div>
    <div className="driver-finance-stats"><article><small>VALOR DOS PEDIDOS</small><strong>{money.format(dashboard.stats.order_value_cents / 100)}</strong></article><article><small>TAXAS DOS CLIENTES</small><strong>{money.format(dashboard.stats.customer_fees_cents / 100)}</strong></article><article><small>REPASSES + DIÁRIAS</small><strong>{money.format(dashboard.stats.driver_payouts_cents / 100)}</strong></article><article><small>RESULTADO LOGÍSTICO BRUTO</small><strong>{money.format(dashboard.stats.logistics_margin_cents / 100)}</strong></article></div>
    <nav className="driver-finance-tabs" aria-label="Motoboys">{dashboard.drivers.map(driver => <button type="button" className={driver.driver_profile_id === selected?.driver_profile_id ? "active" : ""} onClick={() => chooseDriver(driver.driver_profile_id)} key={driver.driver_profile_id}><b>{driver.name}</b><span>{driver.deliveries_count} entregas · {money.format(driver.total_payable_cents / 100)}</span></button>)}</nav>
    {selected && <>
      <div className="driver-finance-layout">
        <form className="driver-finance-form" onSubmit={savePolicy} key={`${selected.driver_profile_id}-${p?.id || "new"}`}><header><small>CONTRATO / REPASSE</small><h3>{selected.name}</h3><p>{p ? `${modelLabels[p.payout_model]} · vigente desde ${new Date(`${p.effective_from}T12:00:00`).toLocaleDateString("pt-BR")}` : "Nenhuma política configurada"}</p></header>
          <div className="field"><label>MODELO</label><select value={model} onChange={event => setModel(event.target.value)}><option value="per_delivery">Por entrega</option><option value="daily">Diária</option><option value="daily_plus_delivery">Diária + entrega</option><option value="salary">Salário</option><option value="salary_plus_commission">Salário + comissão</option><option value="custom">Personalizado</option></select></div>
          {(model === "per_delivery" || model === "daily_plus_delivery") && <div className="field"><label>VALOR POR ENTREGA (R$)</label><input name="per_delivery" inputMode="decimal" defaultValue={p ? (p.per_delivery_cents / 100).toFixed(2) : "0,00"} /></div>}
          {(model === "daily" || model === "daily_plus_delivery") && <div className="field"><label>VALOR DA DIÁRIA (R$)</label><input name="daily_rate" inputMode="decimal" defaultValue={p ? (p.daily_rate_cents / 100).toFixed(2) : "0,00"} /></div>}
          {(model === "salary" || model === "salary_plus_commission") && <div className="field"><label>SALÁRIO MENSAL (R$)</label><input name="salary" inputMode="decimal" defaultValue={p ? (p.monthly_salary_cents / 100).toFixed(2) : "0,00"} /></div>}
          {model === "salary_plus_commission" && <div className="field"><label>COMISSÃO (%)</label><input name="commission" type="number" min="0" max="100" step="0.01" defaultValue={p ? p.commission_basis_points / 100 : 0} /></div>}
          {(model === "per_delivery" || model === "daily_plus_delivery") && <fieldset><legend>VALOR POR DISTÂNCIA · OPCIONAL</legend><label>Até 3 km<input name="distance_3" inputMode="decimal" placeholder="R$ 0,00" /></label><label>3 a 6 km<input name="distance_6" inputMode="decimal" placeholder="R$ 0,00" /></label><label>6 a 10 km<input name="distance_10" inputMode="decimal" placeholder="R$ 0,00" /></label></fieldset>}
          <div className="field"><label>INÍCIO DA VIGÊNCIA</label><input name="effective_from" type="date" required defaultValue={new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })} /></div><button className="button dark" disabled={busy}>Salvar nova política</button>
        </form>
        <form className="driver-finance-form" onSubmit={addAdjustment}><header><small>LANÇAMENTO ADICIONAL</small><h3>Bônus e ajustes</h3><p>Todo lançamento exige valor, motivo, responsável e data.</p></header><div className="field"><label>TIPO</label><select name="type"><option value="bonus">Bônus</option><option value="fuel">Ajuda combustível</option><option value="rain">Adicional de chuva</option><option value="night">Adicional noturno</option><option value="adjustment">Ajuste manual</option></select></div><div className="field"><label>OPERAÇÃO</label><select name="direction"><option value="credit">Somar ao pagamento</option><option value="debit">Descontar do pagamento</option></select></div><div className="field"><label>VALOR (R$)</label><input name="amount" required inputMode="decimal" placeholder="0,00" /></div><div className="field"><label>DATA</label><input name="date" type="date" required defaultValue={new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })} /></div><div className="field"><label>MOTIVO</label><textarea name="reason" required minLength={3} placeholder="Explique o motivo do lançamento" /></div><button className="button outline" disabled={busy}>Registrar com auditoria</button></form>
      </div>
      <div className="driver-finance-history"><header><div><small>HISTÓRICO DO PERÍODO</small><h3>{selected.name}</h3></div><strong>{money.format(selected.total_payable_cents / 100)}</strong></header>{selected.days.length ? selected.days.map(day => <article key={day.date}><div><b>{new Date(`${day.date}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })}</b><strong>{money.format(day.total_cents / 100)}</strong></div>{day.deliveries.map(delivery => <p key={delivery.order_number}>Pedido #{delivery.order_number} · pedido {money.format(delivery.order_value_cents / 100)} · taxa cliente {money.format(delivery.customer_fee_cents / 100)} · repasse {money.format(delivery.driver_payout_cents / 100)}</p>)}{day.entries.map(entry => <p key={entry.id}><b>{entryLabels[entry.type] || entry.type}:</b> {money.format(entry.amount_cents / 100)} · {entry.reason}</p>)}</article>) : <div className="empty compact"><b>Sem movimentação neste período.</b></div>}</div>
    </>}
  </section>;
}
