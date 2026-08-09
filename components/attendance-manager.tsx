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
  id: string; user_id?: string | null; name: string; phone?: string | null;
  status: string; sector?: string | null; active_now: boolean; shift_start?: string | null; shift_end?: string | null;
  employment_type?: "fixed" | "daily"; work_date?: string | null;
  payment_cycle?: "daily" | "weekly" | "biweekly" | "monthly";
  permissions: Record<string, boolean>;
};
type Metric = { waiterId: string; orders: number; salesCents: number; payments: number; tables: number };
type WaiterInvite = {
  waiterId: string; waiterName: string; phone: string; link: string; expiresAt: string;
  employmentType: "fixed" | "daily"; workDate?: string | null; isReset: boolean;
};
const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const statusLabels: Record<string, string> = { active: "Ativo", inactive: "Inativo", serving: "Em atendimento", paused: "Pausado", blocked: "Bloqueado" };
const whatsappNumber = (phone: string) => {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
};
const localDate = () => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
};
const formatWorkDate = (value?: string | null) =>
  value ? new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR") : "";
const inviteMessage = (invite: WaiterInvite) => invite.isReset
  ? `Olá, ${invite.waiterName}! Use este link para criar uma nova senha de acesso ao Mesa Viva: ${invite.link}\n\nDepois de salvar, entre normalmente com seu WhatsApp e a nova senha.`
  : invite.employmentType === "daily"
  ? `Olá, ${invite.waiterName}! Seu acesso de diarista está liberado para ${formatWorkDate(invite.workDate)}. Crie sua senha neste link: ${invite.link}\n\nO acesso aos pedidos funcionará somente na data informada.`
  : `Olá, ${invite.waiterName}! Seu cadastro de funcionário está pronto. Crie sua senha neste link: ${invite.link}\n\nDepois disso, use seu WhatsApp e sua senha para entrar sempre que estiver trabalhando.`;

export function AttendanceManager({ establishmentId, slug, initialMode, initialWaiters, metrics }: {
  establishmentId: string; slug: string; initialMode: Mode; initialWaiters: Waiter[]; metrics: Metric[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [mode, setMode] = useState(initialMode);
  const [waiters, setWaiters] = useState(initialWaiters);
  const [editing, setEditing] = useState<Waiter | null>(null);
  const [employmentType, setEmploymentType] = useState<"fixed" | "daily">("fixed");
  const [inviteReady, setInviteReady] = useState<WaiterInvite | null>(null);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const activeCount = mode.manual_active_waiters ?? waiters.filter(waiter =>
    waiter.active_now
    && ["active", "serving"].includes(waiter.status)
    && (waiter.employment_type !== "daily" || waiter.work_date === localDate())
  ).length;
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
    event.preventDefault();
    const form = event.currentTarget;
    const editingWaiter = editing;
    setBusy(true); setMessage("");
    const data = new FormData(form);
    const values = {
      name: String(data.get("name")), phone: String(data.get("phone") || ""), email: "",
      sector: String(data.get("sector") || ""), status: String(data.get("status") || "inactive"),
      active_now: data.get("active_now") === "on", shift_start: String(data.get("shift_start") || ""),
      shift_end: String(data.get("shift_end") || ""),
      employment_type: String(data.get("employment_type") || "fixed"),
      work_date: employmentType === "daily" ? String(data.get("work_date") || "") : "",
      payment_cycle: String(data.get("payment_cycle") || (employmentType === "daily" ? "daily" : "monthly")),
      permissions: {
        open_tables: data.get("open_tables") === "on", create_orders: data.get("create_orders") === "on",
        close_bills: data.get("close_bills") === "on", register_payments: data.get("register_payments") === "on",
        apply_discount: data.get("apply_discount") === "on", cancel_items: data.get("cancel_items") === "on",
      },
    };
    try {
      const { data: saved, error } = await supabase.rpc("manage_waiter", {
        requested_establishment_id: establishmentId, requested_waiter_id: editingWaiter?.id || null, requested_values: values,
      });
      if (saved) {
        const waiter = saved as Waiter;
        setWaiters(current => editingWaiter ? current.map(item => item.id === waiter.id ? waiter : item) : [...current, waiter]);
        setEditing(null);
        setEmploymentType("fixed");
        form.reset();
        if (!editingWaiter) {
          const invitation = await generateInvite(waiter);
          setMessage(invitation
            ? "Garçom cadastrado. Envie o acesso pelo WhatsApp no cartão dele."
            : "Garçom cadastrado, mas não foi possível gerar o convite. Use “Gerar convite” na lista.");
        } else {
          setMessage("Alterações do garçom salvas.");
        }
      } else {
        setMessage(error?.message || "Não foi possível salvar o garçom.");
      }
    } catch {
      setMessage("O garçom foi processado, mas ocorreu um erro ao preparar o convite. Tente novamente em “Gerar convite”.");
    } finally {
      setBusy(false);
    }
  }
  async function changeStatus(waiter: Waiter, status: string, activeNow: boolean) {
    const { data, error } = await supabase.rpc("manage_waiter", {
      requested_establishment_id: establishmentId, requested_waiter_id: waiter.id,
      requested_values: {
        name: waiter.name, phone: waiter.phone || "", email: "", sector: waiter.sector || "",
        status, active_now: activeNow, shift_start: waiter.shift_start || "", shift_end: waiter.shift_end || "",
        employment_type: waiter.employment_type || "fixed", work_date: waiter.work_date || "",
        payment_cycle: waiter.payment_cycle || (waiter.employment_type === "daily" ? "daily" : "monthly"),
        permissions: waiter.permissions,
      },
    });
    if (error) setMessage(error.message);
    else setWaiters(current => current.map(item => item.id === waiter.id ? data as Waiter : item));
  }
  async function generateInvite(waiter: Waiter) {
    setInvitingId(waiter.id);
    try {
      const { data, error } = await supabase.rpc("create_waiter_invite", { requested_waiter_id: waiter.id });
      if (error || !data?.token) {
        setMessage(error?.message || "Não foi possível gerar o convite.");
        return null;
      }
      const link = `${window.location.origin}/convite-garcom/${data.token}`;
      const invitation = {
        waiterId: waiter.id, waiterName: waiter.name, phone: waiter.phone || "",
        link, expiresAt: data.expires_at,
        employmentType: (data.employment_type || waiter.employment_type || "fixed") as "fixed" | "daily",
        workDate: data.work_date || waiter.work_date,
        isReset: Boolean(waiter.user_id),
      };
      setInviteReady(invitation);
      return invitation;
    } catch {
      setMessage("Não foi possível gerar o convite. Tente novamente.");
      return null;
    } finally {
      setInvitingId(null);
    }
  }
  async function invite(waiter: Waiter) {
    const invitation = await generateInvite(waiter);
    if (invitation) setMessage(`${invitation.isReset ? "Link de redefinição" : "Convite"} de ${waiter.name} gerado. Escolha abaixo como enviar.`);
  }
  async function copyInvite() {
    if (!inviteReady) return;
    await navigator.clipboard.writeText(inviteReady.link);
    setMessage("Link de acesso copiado.");
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

    <section className="panel waiter-admin" id="equipe-garcons">
      <div className="panel-title-row"><div><h2>Garçons ativos no momento</h2><p>Cadastre, pause, bloqueie e gere o acesso individual da equipe.</p></div><span className="status-pill">{activeCount} agora</span></div>
      <form className="waiter-admin-form form" onSubmit={saveWaiter}>
        <div className="form-grid">
          <div className="field"><label>NOME</label><input name="name" required defaultValue={editing?.name || ""} key={`name-${editing?.id}`} /></div>
          <div className="field"><label>TELEFONE</label><input name="phone" type="tel" inputMode="tel" placeholder="(21) 98139-2823" defaultValue={editing?.phone || ""} key={`phone-${editing?.id}`} /></div>
          <div className="field"><label>SETOR</label><input name="sector" placeholder="Salão, varanda..." defaultValue={editing?.sector || ""} key={`sector-${editing?.id}`} /></div>
          <div className="field"><label>STATUS</label><select name="status" defaultValue={editing?.status || "inactive"} key={`status-${editing?.id}`}>{Object.entries(statusLabels).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></div>
          <div className="field"><label>TIPO DE CONTRATAÇÃO</label><select name="employment_type" value={employmentType} onChange={event => setEmploymentType(event.target.value as "fixed" | "daily")}><option value="fixed">Funcionário fixo</option><option value="daily">Diarista</option></select></div>
          <div className="field"><label>FORMA DE PAGAMENTO</label><select name="payment_cycle" defaultValue={editing?.payment_cycle || (employmentType === "daily" ? "daily" : "monthly")} key={`payment-${editing?.id}-${employmentType}`}><option value="daily">Diária</option><option value="weekly">Semanal</option><option value="biweekly">Quinzenal</option><option value="monthly">Mensal</option></select></div>
          {employmentType === "daily" && <div className="field"><label>DATA DA DIÁRIA</label><input name="work_date" type="date" min={localDate()} required defaultValue={editing?.work_date || localDate()} key={`work-date-${editing?.id}`} /><small>O acesso funcionará somente neste dia.</small></div>}
          <div className="field"><label>TURNO</label><div className="shift-fields"><input name="shift_start" type="time" defaultValue={editing?.shift_start?.slice(0,5) || ""} /><input name="shift_end" type="time" defaultValue={editing?.shift_end?.slice(0,5) || ""} /></div></div>
        </div>
        <label className="choice-card"><input name="active_now" type="checkbox" defaultChecked={editing?.active_now} key={`active-${editing?.id}`} /><span><b>Ativo no momento</b><small>Permite operar mesas e pagamentos agora.</small></span></label>
        <div className="permission-grid">{[["open_tables","Abrir mesas"],["create_orders","Lançar pedidos"],["close_bills","Fechar contas"],["register_payments","Registrar pagamentos"],["apply_discount","Aplicar desconto"],["cancel_items","Cancelar itens"]].map(([key,label]) => <label key={key}><input type="checkbox" name={key} defaultChecked={editing ? editing.permissions?.[key] : !["apply_discount","cancel_items"].includes(key)} /> {label}</label>)}</div>
        <div className="form-actions"><button type="button" className="button outline" onClick={() => { setEditing(null); setEmploymentType("fixed"); }}>Limpar</button><button className="button dark" disabled={busy}>{editing ? "Salvar alterações" : "Cadastrar garçom"}</button></div>
      </form>
      <div className="waiter-admin-list">{waiters.map(waiter => {
        const metric = metrics.find(value => value.waiterId === waiter.id);
        const currentInvite = inviteReady?.waiterId === waiter.id ? inviteReady : null;
        return <article key={waiter.id}>
          <div className="waiter-avatar">{waiter.name.slice(0,2).toUpperCase()}</div>
          <div><span className={`waiter-status status-${waiter.status}`}>{statusLabels[waiter.status]}</span><h3>{waiter.name}</h3><p>{waiter.sector || "Sem setor"} · {waiter.employment_type === "daily" ? `Diarista em ${formatWorkDate(waiter.work_date)}` : "Funcionário fixo"} · Pagamento {waiter.payment_cycle === "daily" ? "por diária" : waiter.payment_cycle === "weekly" ? "semanal" : waiter.payment_cycle === "biweekly" ? "quinzenal" : "mensal"} · {waiter.user_id ? "Acesso vinculado" : "Aguardando senha"}</p></div>
          <div className="waiter-mini-metrics"><span>{metric?.tables || 0}<small>mesas</small></span><span>{metric?.orders || 0}<small>pedidos</small></span><span>{money(metric?.salesCents || 0)}<small>vendido</small></span></div>
          <div className="waiter-row-actions">
            <button type="button" onClick={() => { setEditing(waiter); setEmploymentType(waiter.employment_type || "fixed"); }}>Editar</button>
            <button type="button" disabled={invitingId === waiter.id} onClick={() => invite(waiter)}>{invitingId === waiter.id ? "Gerando..." : waiter.user_id ? "Redefinir senha" : "Enviar acesso"}</button>
            {waiter.status === "blocked" ? <button type="button" onClick={() => changeStatus(waiter, "inactive", false)}>Desbloquear</button> : <button type="button" onClick={() => changeStatus(waiter, "blocked", false)}>Bloquear</button>}
            {waiter.active_now ? <button type="button" onClick={() => changeStatus(waiter, "paused", false)}>Pausar</button> : <button type="button" onClick={() => changeStatus(waiter, "active", true)}>Ativar</button>}
          </div>
          {currentInvite && <div className="waiter-invite-ready waiter-inline-invite" role="status">
            <div className="invite-ready-heading">
              <div><small>{currentInvite.isReset ? "REDEFINIÇÃO PRONTA" : "ACESSO PRONTO"}</small><h3>{currentInvite.isReset ? "Enviar nova senha para" : "Enviar acesso para"} {currentInvite.waiterName}</h3></div>
              <button type="button" aria-label="Fechar convite" onClick={() => setInviteReady(null)}>×</button>
            </div>
            <p>{currentInvite.isReset
              ? "Este link permite criar uma nova senha. Depois, o funcionário entra normalmente com o WhatsApp cadastrado e a nova senha."
              : currentInvite.employmentType === "daily"
              ? `Este acesso funcionará somente em ${formatWorkDate(currentInvite.workDate)}. Envie o link para o diarista criar a senha.`
              : "Funcionário fixo: após criar a senha uma vez, ele entra sempre com WhatsApp e senha enquanto o cadastro estiver ativo."}</p>
            <div className="invite-link-box"><span>{currentInvite.link}</span><button type="button" onClick={copyInvite}>Copiar link</button></div>
            <div className="invite-ready-actions">
              {whatsappNumber(currentInvite.phone)
                ? <a className="button whatsapp" target="_blank" rel="noreferrer" href={`https://wa.me/${whatsappNumber(currentInvite.phone)}?text=${encodeURIComponent(inviteMessage(currentInvite))}`}>Enviar pelo WhatsApp</a>
                : <span className="invite-phone-warning">Cadastre um telefone para usar o WhatsApp.</span>}
              <small>Válido até {new Date(currentInvite.expiresAt).toLocaleString("pt-BR")}.</small>
            </div>
          </div>}
        </article>;
      })}</div>
    </section>
    {message && <div className={["salvo", "salvas", "copiado", "cadastrado", "gerado"].some(term => message.includes(term)) ? "form-message form-success sticky-message" : "form-message sticky-message"}>{message}</div>}
  </div>;
}
