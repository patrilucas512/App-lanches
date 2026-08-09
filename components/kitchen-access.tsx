"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type KitchenOperator = {
  id: string;
  user_id?: string | null;
  name: string;
  phone: string;
  status: "active" | "inactive" | "blocked";
  access_type: "fixed" | "daily";
  work_date?: string | null;
  device_mode: "shared" | "dedicated";
  payment_cycle: "daily" | "weekly" | "biweekly" | "monthly";
  permissions: { accept_orders?: boolean; print_orders?: boolean; mark_ready?: boolean };
};

function normalizeBrazilianPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) return digits;
  return digits;
}

function loginEmailForPhone(value: string) {
  return `k.${normalizeBrazilianPhone(value)}@cozinha.mesaviva.app`;
}

function localDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function PasswordInput({ name, label, autoComplete }: { name: string; label: string; autoComplete: string }) {
  const [visible, setVisible] = useState(false);
  return <div className="field"><label>{label}</label><div className="password-input-wrap">
    <input name={name} type={visible ? "text" : "password"} minLength={8} required autoComplete={autoComplete} />
    <button type="button" className="password-visibility" aria-label={visible ? "Ocultar senha" : "Visualizar senha"} onClick={() => setVisible(value => !value)}>{visible ? "◉" : "👁"}</button>
  </div></div>;
}

export function KitchenLoginForm() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const phone = String(form.get("phone"));
    if (normalizeBrazilianPhone(phone).length < 12) { setMessage("Informe um WhatsApp válido com DDD."); setBusy(false); return; }
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email: loginEmailForPhone(phone), password: String(form.get("password")) });
    if (error) { setMessage("WhatsApp ou senha inválidos."); setBusy(false); return; }
    const userId = (await supabase.auth.getUser()).data.user?.id;
    const { data: operator } = await supabase.from("kitchen_operators").select("status,access_type,work_date").eq("user_id", userId).maybeSingle();
    const unavailable = !operator || operator.status !== "active" || (operator.access_type === "daily" && operator.work_date !== localDate());
    if (unavailable) { await supabase.auth.signOut(); setMessage("Este acesso está inativo ou fora da data liberada pelo administrador."); }
    else window.location.assign("/cozinha");
    setBusy(false);
  }
  return <form className="form" onSubmit={login}>
    <div className="field"><label>WHATSAPP DO OPERADOR</label><input name="phone" type="tel" inputMode="tel" required autoComplete="tel" placeholder="(21) 98139-2823" /></div>
    <PasswordInput name="password" label="SENHA" autoComplete="current-password" />
    {message && <div className="form-message">{message}</div>}
    <button className="button dark wide" disabled={busy}>{busy ? "Entrando..." : "Abrir tela da cozinha →"}</button>
    <p className="auth-switch">Primeiro acesso? Abra o link enviado pelo administrador.</p>
  </form>;
}

export function KitchenInviteClaim({ token }: { token: string }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password"));
    if (password !== String(form.get("confirmation"))) { setMessage("As duas senhas precisam ser iguais."); setBusy(false); return; }
    const supabase = createClient();
    const { data, error } = await supabase.functions.invoke("activate-kitchen-access", { body: { token, password } });
    if (error || !data?.login_email) { setMessage(data?.error || "Não foi possível ativar este acesso."); setBusy(false); return; }
    const { error: loginError } = await supabase.auth.signInWithPassword({ email: data.login_email, password });
    if (loginError) { setMessage("Senha criada. Entre com seu WhatsApp e essa senha."); setBusy(false); return; }
    setMessage("Acesso ativado. Abrindo a cozinha...");
    window.setTimeout(() => window.location.assign("/cozinha"), 500);
  }
  return <div className="auth-card waiter-invite-card"><span className="kicker">ACESSO DA COZINHA</span><h1>Crie sua senha.</h1><p>Seu WhatsApp já foi autorizado. Esta conta abrirá somente a operação da cozinha.</p>
    <form className="form" onSubmit={activate}>
      <PasswordInput name="password" label="CRIE UMA SENHA" autoComplete="new-password" />
      <PasswordInput name="confirmation" label="CONFIRME A SENHA" autoComplete="new-password" />
      <button className="button dark wide" disabled={busy}>{busy ? "Liberando..." : "Criar senha e abrir cozinha →"}</button>
      <p className="auth-switch">Já criou sua senha? <Link href="/cozinha/login">Entrar na cozinha</Link></p>
    </form>{message && <div className="form-message">{message}</div>}
  </div>;
}

export function KitchenAccessManager({ establishmentId, initialOperators }: { establishmentId: string; initialOperators: KitchenOperator[] }) {
  const [operators, setOperators] = useState(initialOperators);
  const [editing, setEditing] = useState<KitchenOperator | null>(null);
  const [accessType, setAccessType] = useState<"fixed" | "daily">("fixed");
  const [message, setMessage] = useState("");
  const [invite, setInvite] = useState<{ name: string; phone: string; link: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function createInvite(operator: KitchenOperator) {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("create_kitchen_invite", { requested_operator_id: operator.id });
    if (error) { setMessage(error.message); return; }
    setInvite({ name: operator.name, phone: operator.phone, link: `${window.location.origin}/convite-cozinha/${data.token}` });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(""); setInvite(null);
    const form = new FormData(event.currentTarget);
    const values = {
      name: String(form.get("name")), phone: String(form.get("phone")), status: String(form.get("status")),
      access_type: accessType, work_date: accessType === "daily" ? String(form.get("work_date")) : "",
      payment_cycle: String(form.get("payment_cycle") || (accessType === "daily" ? "daily" : "monthly")),
      device_mode: String(form.get("device_mode")), permissions: {
        accept_orders: form.has("accept_orders"), print_orders: form.has("print_orders"), mark_ready: form.has("mark_ready"),
      },
    };
    const supabase = createClient();
    const { data, error } = await supabase.rpc("manage_kitchen_operator", { requested_establishment_id: establishmentId, requested_operator_id: editing?.id || null, requested_values: values });
    if (error) setMessage(error.message);
    else {
      const saved = data as KitchenOperator;
      setOperators(current => editing ? current.map(item => item.id === saved.id ? saved : item) : [...current, saved]);
      setEditing(saved); setAccessType(saved.access_type); setMessage("Acesso salvo. Gere o link para o operador criar a senha.");
      await createInvite(saved);
    }
    setBusy(false);
  }

  async function toggle(operator: KitchenOperator) {
    const nextStatus = operator.status === "active" ? "blocked" : "active";
    const supabase = createClient();
    const { data, error } = await supabase.rpc("manage_kitchen_operator", { requested_establishment_id: establishmentId, requested_operator_id: operator.id, requested_values: { ...operator, status: nextStatus, work_date: operator.work_date || "" } });
    if (error) setMessage(error.message); else setOperators(current => current.map(item => item.id === operator.id ? data as KitchenOperator : item));
  }

  function beginEdit(operator: KitchenOperator) { setEditing(operator); setAccessType(operator.access_type); setInvite(null); setMessage(""); }
  const whatsappMessage = invite ? `Olá, ${invite.name}! Seu acesso à cozinha está pronto. Crie sua senha neste link: ${invite.link}` : "";
  return <section className="panel kitchen-access-admin" id="equipe-cozinha">
    <div className="section-heading"><div><small>ACESSO SEPARADO</small><h2>Equipe da cozinha</h2><p>O operador entra pelo próprio WhatsApp e vê apenas pedidos, preparo e impressão.</p></div><Link className="button dark" href="/cozinha" target="_blank">Abrir cozinha</Link></div>
    <div className="kitchen-access-layout">
      <form className="form kitchen-operator-form" onSubmit={save} key={editing?.id || "new"}>
        <div className="field"><label>NOME DO OPERADOR</label><input name="name" required minLength={2} defaultValue={editing?.name || ""} placeholder="Ex.: João da cozinha" /></div>
        <div className="field"><label>WHATSAPP</label><input name="phone" type="tel" required defaultValue={editing?.phone || ""} placeholder="(21) 98139-2823" /></div>
        <div className="form-grid two"><div className="field"><label>TIPO DE ACESSO</label><select value={accessType} onChange={event => setAccessType(event.target.value as "fixed" | "daily")}><option value="fixed">Funcionário fixo</option><option value="daily">Somente um dia</option></select></div>
          <div className="field"><label>STATUS</label><select name="status" defaultValue={editing?.status || "active"}><option value="active">Ativo</option><option value="inactive">Inativo</option><option value="blocked">Bloqueado</option></select></div></div>
        {accessType === "daily" && <div className="field"><label>DATA DE TRABALHO</label><input name="work_date" type="date" required min={localDate()} defaultValue={editing?.work_date || localDate()} /></div>}
        <div className="field"><label>FORMA DE PAGAMENTO</label><select name="payment_cycle" defaultValue={editing?.payment_cycle || (accessType === "daily" ? "daily" : "monthly")} key={`payment-${editing?.id}-${accessType}`}><option value="daily">Diária</option><option value="weekly">Semanal</option><option value="biweekly">Quinzenal</option><option value="monthly">Mensal</option></select></div>
        <div className="field"><label>ONDE A TELA SERÁ USADA?</label><select name="device_mode" defaultValue={editing?.device_mode || "dedicated"}><option value="dedicated">Tela exclusiva da cozinha</option><option value="shared">Notebook ou celular do administrador</option></select></div>
        <div className="permission-grid"><label><input type="checkbox" name="accept_orders" defaultChecked={editing?.permissions.accept_orders ?? true} /> Aceitar pedidos</label><label><input type="checkbox" name="print_orders" defaultChecked={editing?.permissions.print_orders ?? true} /> Imprimir comandas</label><label><input type="checkbox" name="mark_ready" defaultChecked={editing?.permissions.mark_ready ?? true} /> Marcar como pronto</label></div>
        <div className="form-actions"><button className="button dark" disabled={busy}>{busy ? "Salvando..." : editing ? "Salvar alterações" : "Cadastrar e gerar acesso"}</button>{editing && <button className="button outline" type="button" onClick={() => { setEditing(null); setAccessType("fixed"); setInvite(null); }}>Novo operador</button>}</div>
      </form>
      <div className="kitchen-operator-list">{operators.length === 0 ? <div className="empty-state">Nenhum operador cadastrado.</div> : operators.map(operator => <article key={operator.id}><div><span className={`waiter-status status-${operator.status}`}>{operator.status === "active" ? "ATIVO" : operator.status === "blocked" ? "BLOQUEADO" : "INATIVO"}</span><h3>{operator.name}</h3><p>{operator.access_type === "daily" ? `Acesso em ${new Date(`${operator.work_date}T12:00:00`).toLocaleDateString("pt-BR")}` : "Funcionário fixo"} · Pagamento {operator.payment_cycle === "daily" ? "por diária" : operator.payment_cycle === "weekly" ? "semanal" : operator.payment_cycle === "biweekly" ? "quinzenal" : "mensal"} · {operator.device_mode === "dedicated" ? "Tela exclusiva" : "Tela compartilhada"}</p><small>{operator.user_id ? "Senha criada" : "Aguardando criação da senha"}</small></div><div className="waiter-row-actions"><button type="button" onClick={() => beginEdit(operator)}>Editar</button><button type="button" onClick={() => void createInvite(operator)}>{operator.user_id ? "Redefinir senha" : "Gerar acesso"}</button><button type="button" onClick={() => void toggle(operator)}>{operator.status === "active" ? "Bloquear" : "Ativar"}</button></div></article>)}</div>
    </div>
    {invite && <div className="waiter-invite-ready"><div><small>LINK PRONTO</small><h3>Envie para {invite.name}</h3><p>Ao abrir, a pessoa cria a senha e passa a entrar apenas na cozinha.</p></div><div className="invite-actions"><a className="button whatsapp" target="_blank" rel="noreferrer" href={`https://wa.me/${normalizeBrazilianPhone(invite.phone)}?text=${encodeURIComponent(whatsappMessage)}`}>Enviar pelo WhatsApp</a><button className="button outline" type="button" onClick={() => void navigator.clipboard.writeText(invite.link)}>Copiar link</button></div></div>}
    {message && <div className="form-message">{message}</div>}
  </section>;
}
