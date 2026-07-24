"use client";

import { FormEvent, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Mode = {
  mode: string; waiter_mode_enabled: boolean; table_service_enabled: boolean; counter_pickup_enabled: boolean;
  delivery_enabled: boolean; customer_self_order_enabled: boolean; waiter_call_enabled: boolean;
  bill_closing_enabled: boolean; card_proof_required: boolean; manual_active_waiters?: number | null;
  accepted_payment_methods: string[]; manager_approval_for_discount: boolean;
  manager_approval_for_cancellation: boolean; audit_enabled: boolean;
};
type Waiter = {
  id: string; user_id?: string | null; name: string; phone?: string | null; email?: string | null;
  status: string; sector?: string | null; active_now: boolean; shift_start?: string | null; shift_end?: string | null;
  permissions: Record<string, boolean>;
};
type Metric = { waiterId: string; orders: number; salesCents: number; payments: number; tables: number };
const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const statusLabels: Record<string, string> = { active: "Ativo", inactive: "Inativo", serving: "Em atendimento", paused: "Pausado", blocked: "Bloqueado" };

export function AttendanceManager({ establishmentId, slug, initialMode, initialWaiters, metrics }: {
  establishmentId: string; slug: string; initialMode: Mode; initialWaiters: Waiter[]; metrics: Metric[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [mode, setMode] = useState(initialMode);
  const [waiters, setWaiters] = useState(initialWaiters);
  const [editing, setEditing] = useState<Waiter | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const activeCount = mode.manual_active_waiters ?? waiters.filter(waiter => waiter.active_now && ["active", "serving"].includes(waiter.status)).length;
  const patch = <K extends keyof Mode>(key: K, value: Mode[K]) => setMode(current => ({ ...current, [key]: value }));

  async function saveMode() {
    setBusy(true); setMessage("");
    const { data, error } = await supabase.rpc("update_service_mode", {
      requested_establishment_id: establishmentId, requested_config: mode,
    });
    if (data) setMode(data as Mode);
    setMessage(error ? error.message : "Modo de atendimento salvo e aplicado ao cardápio.");
    setBusy(false);
  }
  async function saveWaiter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const data = new FormData(event.currentTarget);
    const values = {
      name: String(data.get("name")), phone: String(data.get("phone") || ""), email: String(data.get("email") || ""),
      sector: String(data.get("sector") || ""), status: String(data.get("status") || "inactive"),
      active_now: data.get("active_now") === "on", shift_start: String(data.get("shift_start") || ""),
      shift_end: String(data.get("shift_end") || ""),
      permissions: {
        open_tables: data.get("open_tables") === "on", create_orders: data.get("create_orders") === "on",
        close_bills: data.get("close_bills") === "on", register_payments: data.get("register_payments") === "on",
        apply_discount: data.get("apply_discount") === "on", cancel_items: data.get("cancel_items") === "on",
      },
    };
    const { data: saved, error } = await supabase.rpc("manage_waiter", {
      requested_establishment_id: establishmentId, requested_waiter_id: editing?.id || null, requested_values: values,
    });
    if (saved) {
      const waiter = saved as Waiter;
      setWaiters(current => editing ? current.map(item => item.id === waiter.id ? waiter : item) : [...current, waiter]);
      setEditing(null); event.currentTarget.reset();
    }
    setMessage(error ? error.message : "Garçom salvo.");
    setBusy(false);
  }
  async function changeStatus(waiter: Waiter, status: string, activeNow: boolean) {
    const { data, error } = await supabase.rpc("manage_waiter", {
      requested_establishment_id: establishmentId, requested_waiter_id: waiter.id,
      requested_values: { name: waiter.name, phone: waiter.phone || "", email: waiter.email || "", sector: waiter.sector || "", status, active_now: activeNow, shift_start: waiter.shift_start || "", shift_end: waiter.shift_end || "", permissions: waiter.permissions },
    });
    if (error) setMessage(error.message);
    else setWaiters(current => current.map(item => item.id === waiter.id ? data as Waiter : item));
  }
  async function invite(waiter: Waiter) {
    const { data, error } = await supabase.rpc("create_waiter_invite", { requested_waiter_id: waiter.id });
    if (error) return setMessage(error.message);
    const link = `${window.location.origin}/convite-garcom/${data.token}`;
    await navigator.clipboard.writeText(link);
    setMessage(`Link de convite copiado. Válido até ${new Date(data.expires_at).toLocaleString("pt-BR")}.`);
  }
  const togglePayment = (value: string) => patch("accepted_payment_methods", mode.accepted_payment_methods.includes(value)
    ? mode.accepted_payment_methods.filter(item => item !== value) : [...mode.accepted_payment_methods, value]);

  return <div className="attendance-manager">
    <section className="attendance-summary">
      <article><small>MODO ATUAL</small><strong>{mode.mode === "counter" ? "Balcão" : mode.mode === "delivery" ? "Entrega" : mode.mode === "waiter" ? "Com garçom" : "Misto"}</strong></article>
      <article><small>GARÇONS ATIVOS AGORA</small><strong>{activeCount}</strong></article>
      <article><small>LINK DO GARÇOM</small><strong className="small-value">/garcom/{slug}</strong></article>
    </section>

    <section className="panel attendance-config">
      <div className="panel-title-row"><div><h2>Como o estabelecimento atende?</h2><p>O cardápio e a operação mudam automaticamente conforme estas escolhas.</p></div><button className="button dark" disabled={busy} onClick={saveMode}>Salvar atendimento</button></div>
      <div className="mode-choice-grid">
        {[["counter", "Apenas balcão", "Cliente pede e retira no local."], ["delivery", "Apenas entrega", "Pedidos com endereço de entrega."], ["waiter", "Com garçom", "Mesas, cozinha e fechamento."], ["mixed", "Atendimento misto", "Todos os canais configuráveis."]].map(([value, title, text]) =>
          <button key={value} className={mode.mode === value ? "selected" : ""} onClick={() => {
            patch("mode", value);
            if (value === "counter") setMode(current => ({ ...current, mode: value, waiter_mode_enabled: false, table_service_enabled: false, counter_pickup_enabled: true, delivery_enabled: false }));
            if (value === "delivery") setMode(current => ({ ...current, mode: value, waiter_mode_enabled: false, table_service_enabled: false, counter_pickup_enabled: false, delivery_enabled: true }));
            if (value === "waiter") setMode(current => ({ ...current, mode: value, waiter_mode_enabled: true, table_service_enabled: true }));
          }}><b>{title}</b><span>{text}</span></button>)}
      </div>
      <div className="attendance-toggle-grid">
        {[
          ["waiter_mode_enabled", "Usa garçons"], ["table_service_enabled", "Trabalha com mesas"],
          ["counter_pickup_enabled", "Retirada no balcão"], ["delivery_enabled", "Entrega"],
          ["customer_self_order_enabled", "Cliente pode pedir sozinho"], ["waiter_call_enabled", "Cliente pode chamar garçom"],
          ["bill_closing_enabled", "Fechamento de mesa"], ["audit_enabled", "Registrar auditoria"],
          ["card_proof_required", "Exigir comprovante no cartão"], ["manager_approval_for_discount", "Desconto exige gerente"],
          ["manager_approval_for_cancellation", "Cancelamento exige gerente"],
        ].map(([key, label]) => <label className="switch-row" key={key}><span>{label}</span><input type="checkbox" checked={Boolean(mode[key as keyof Mode])} onChange={event => patch(key as keyof Mode, event.target.checked as never)} /></label>)}
      </div>
      <div className="payment-config"><h3>Formas de pagamento aceitas</h3>{[["pix","Pix"],["cash","Dinheiro"],["credit_card","Crédito"],["debit_card","Débito"]].map(([value,label]) => <label key={value}><input type="checkbox" checked={mode.accepted_payment_methods.includes(value)} onChange={() => togglePayment(value)} /> {label}</label>)}</div>
      <div className="field manual-waiters"><label>QUANTIDADE MANUAL DE GARÇONS ATIVOS (OPCIONAL)</label><input type="number" min="0" value={mode.manual_active_waiters ?? ""} onChange={event => patch("manual_active_waiters", event.target.value === "" ? null : Number(event.target.value))} /><small>Deixe vazio para calcular automaticamente pela lista.</small></div>
    </section>

    <section className="panel waiter-admin">
      <div className="panel-title-row"><div><h2>Garçons ativos no momento</h2><p>Cadastre, pause, bloqueie e gere o acesso individual da equipe.</p></div><span className="status-pill">{activeCount} agora</span></div>
      <form className="waiter-admin-form form" onSubmit={saveWaiter}>
        <div className="form-grid">
          <div className="field"><label>NOME</label><input name="name" required defaultValue={editing?.name || ""} key={`name-${editing?.id}`} /></div>
          <div className="field"><label>TELEFONE</label><input name="phone" defaultValue={editing?.phone || ""} key={`phone-${editing?.id}`} /></div>
          <div className="field"><label>E-MAIL DE ACESSO</label><input name="email" type="email" defaultValue={editing?.email || ""} key={`email-${editing?.id}`} /></div>
          <div className="field"><label>SETOR</label><input name="sector" placeholder="Salão, varanda..." defaultValue={editing?.sector || ""} key={`sector-${editing?.id}`} /></div>
          <div className="field"><label>STATUS</label><select name="status" defaultValue={editing?.status || "inactive"} key={`status-${editing?.id}`}>{Object.entries(statusLabels).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></div>
          <div className="field"><label>TURNO</label><div className="shift-fields"><input name="shift_start" type="time" defaultValue={editing?.shift_start?.slice(0,5) || ""} /><input name="shift_end" type="time" defaultValue={editing?.shift_end?.slice(0,5) || ""} /></div></div>
        </div>
        <label className="choice-card"><input name="active_now" type="checkbox" defaultChecked={editing?.active_now} key={`active-${editing?.id}`} /><span><b>Ativo no momento</b><small>Permite operar mesas e pagamentos agora.</small></span></label>
        <div className="permission-grid">{[["open_tables","Abrir mesas"],["create_orders","Lançar pedidos"],["close_bills","Fechar contas"],["register_payments","Registrar pagamentos"],["apply_discount","Aplicar desconto"],["cancel_items","Cancelar itens"]].map(([key,label]) => <label key={key}><input type="checkbox" name={key} defaultChecked={editing ? editing.permissions?.[key] : !["apply_discount","cancel_items"].includes(key)} /> {label}</label>)}</div>
        <div className="form-actions"><button type="button" className="button outline" onClick={() => setEditing(null)}>Limpar</button><button className="button dark" disabled={busy}>{editing ? "Salvar alterações" : "Cadastrar garçom"}</button></div>
      </form>
      <div className="waiter-admin-list">{waiters.map(waiter => {
        const metric = metrics.find(value => value.waiterId === waiter.id);
        return <article key={waiter.id}><div className="waiter-avatar">{waiter.name.slice(0,2).toUpperCase()}</div><div><span className={`waiter-status status-${waiter.status}`}>{statusLabels[waiter.status]}</span><h3>{waiter.name}</h3><p>{waiter.sector || "Sem setor"} · {waiter.user_id ? "Acesso vinculado" : "Aguardando convite"}</p></div><div className="waiter-mini-metrics"><span>{metric?.tables || 0}<small>mesas</small></span><span>{metric?.orders || 0}<small>pedidos</small></span><span>{money(metric?.salesCents || 0)}<small>vendido</small></span></div><div className="waiter-row-actions"><button onClick={() => setEditing(waiter)}>Editar</button><button onClick={() => invite(waiter)}>Copiar convite</button>{waiter.status === "blocked" ? <button onClick={() => changeStatus(waiter, "inactive", false)}>Desbloquear</button> : <button onClick={() => changeStatus(waiter, "blocked", false)}>Bloquear</button>}{waiter.active_now ? <button onClick={() => changeStatus(waiter, "paused", false)}>Pausar</button> : <button onClick={() => changeStatus(waiter, "active", true)}>Ativar</button>}</div></article>;
      })}</div>
    </section>
    {message && <div className={message.includes("salvo") || message.includes("copiado") ? "form-message form-success sticky-message" : "form-message sticky-message"}>{message}</div>}
  </div>;
}
