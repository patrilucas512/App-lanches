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

function localDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

async function functionErrorMessage(error: unknown, fallback: string) {
  if (!error || typeof error !== "object" || !("context" in error)) return fallback;
  const response = (error as { context?: Response }).context;
  if (!response || typeof response.clone !== "function") return fallback;
  try {
    const body = await response.clone().json() as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
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
    const name = String(form.get("name")).trim().replace(/\s+/g, " ");
    if (name.split(" ").length < 2) { setMessage("Informe seu nome e sobrenome."); setBusy(false); return; }
    const supabase = createClient();
    const rememberedEstablishment = typeof window !== "undefined" ? window.localStorage.getItem("mesa_viva_kitchen_slug") : null;
    let response = await supabase.functions.invoke("employee-login", {
      body: { kind: "kitchen", name, password: String(form.get("password")), establishment: rememberedEstablishment },
    });
    if (rememberedEstablishment && (!response.data?.access_token || !response.data?.refresh_token)) {
      response = await supabase.functions.invoke("employee-login", {
        body: { kind: "kitchen", name, password: String(form.get("password")), establishment: null },
      });
    }
    const { data, error } = response;
    if (error || !data?.access_token || !data?.refresh_token) {
      setMessage(data?.error || await functionErrorMessage(error, "Nome ou senha inválidos.")); setBusy(false); return;
    }
    const { error: sessionError } = await supabase.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
    if (sessionError) { setMessage("Não foi possível abrir seu acesso agora."); setBusy(false); return; }
    if (data.establishment_slug) window.localStorage.setItem("mesa_viva_kitchen_slug", data.establishment_slug);
    window.location.assign("/cozinha");
  }
  return <form className="form" onSubmit={login}>
    <div className="field"><label>NOME E SOBRENOME</label><input name="name" type="text" required autoComplete="name" placeholder="Ex.: João da Silva" /></div>
    <PasswordInput name="password" label="SENHA" autoComplete="current-password" />
    {message && <div className={`form-message ${message.includes("excluído") ? "form-success" : ""}`}>{message}</div>}
    <button className="button dark wide" disabled={busy}>{busy ? "Entrando..." : "Abrir tela da cozinha →"}</button>
    <button type="button" className="auth-recovery-link auth-recovery-button" onClick={() => setMessage("Peça ao administrador para abrir Equipe da cozinha, tocar em Redefinir senha e enviar um novo link pelo WhatsApp.")}>Esqueci minha senha</button>
    <p className="auth-switch">Primeiro acesso? Abra o link enviado pelo administrador. Depois, entre somente com seu nome e senha.</p>
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
    if (error || !data?.login_email) {
      setMessage(data?.error || await functionErrorMessage(error, "Não foi possível ativar este acesso. Peça um novo link ao administrador."));
      setBusy(false);
      return;
    }
    const { error: loginError } = await supabase.auth.signInWithPassword({ email: data.login_email, password });
    if (loginError) { setMessage("Senha criada. Entre com seu nome completo e essa senha."); setBusy(false); return; }
    if (data.establishment_slug) window.localStorage.setItem("mesa_viva_kitchen_slug", data.establishment_slug);
    setMessage("Acesso ativado. Abrindo a cozinha...");
    window.setTimeout(() => window.location.replace("/cozinha"), 350);
  }
  return <div className="auth-card waiter-invite-card"><span className="kicker">ACESSO DA COZINHA</span><h1>Crie sua senha.</h1><p>Seu cadastro já foi autorizado. Esta conta abrirá somente a operação da cozinha.</p>
    <form className="form" onSubmit={activate}>
      <PasswordInput name="password" label="CRIE UMA SENHA" autoComplete="new-password" />
      <PasswordInput name="confirmation" label="CONFIRME A SENHA" autoComplete="new-password" />
      <button className="button dark wide" disabled={busy}>{busy ? "Liberando..." : "Criar senha e abrir cozinha →"}</button>
      <p className="auth-switch">Já criou sua senha? <Link href="/cozinha/login">Entrar com nome e senha</Link></p>
    </form>{message && <div className="form-message">{message}</div>}
  </div>;
}

export function KitchenAccessManager({ establishmentId, initialOperators }: { establishmentId: string; initialOperators: KitchenOperator[] }) {
  const [operators, setOperators] = useState(initialOperators);
  const [editing, setEditing] = useState<KitchenOperator | null>(null);
  const [accessType, setAccessType] = useState<"fixed" | "daily">("fixed");
  const [message, setMessage] = useState("");
  const [invite, setInvite] = useState<{ name: string; phone: string; link: string; isReset: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function createInvite(operator: KitchenOperator) {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("create_kitchen_invite", { requested_operator_id: operator.id });
    if (error) { setMessage(error.message); return; }
    setInvite({ name: operator.name, phone: operator.phone, link: `${window.location.origin}/convite-cozinha/${data.token}`, isReset: Boolean(operator.user_id) });
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

  async function removeOperator(operator: KitchenOperator) {
    if (!window.confirm(`Excluir o cadastro de ${operator.name}? O acesso à cozinha será removido imediatamente.`)) return;
    setBusy(true); setMessage(""); setInvite(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("delete_kitchen_operator", { requested_operator_id: operator.id });
    if (error) setMessage(error.message);
    else {
      setOperators(current => current.filter(item => item.id !== operator.id));
      if (editing?.id === operator.id) { setEditing(null); setAccessType("fixed"); }
      setMessage(`${operator.name} foi excluído da equipe da cozinha.`);
    }
    setBusy(false);
  }

  function beginEdit(operator: KitchenOperator) { setEditing(operator); setAccessType(operator.access_type); setInvite(null); setMessage(""); }
  const whatsappMessage = invite
    ? invite.isReset
      ? `Olá, ${invite.name}! Use este link para criar uma nova senha de acesso à cozinha do Mesa Viva: ${invite.link}\n\nDepois de salvar, entre normalmente com seu nome completo e a nova senha.`
      : `Olá, ${invite.name}! Seu acesso à cozinha está pronto. Crie sua senha neste link: ${invite.link}\n\nDepois, entre usando seu nome completo e a senha.`
    : "";
  return <section className="panel kitchen-access-admin" id="equipe-cozinha">
    <div className="section-heading"><div><small>ACESSO SEPARADO</small><h2>Equipe da cozinha</h2><p>O operador recebe o acesso pelo WhatsApp e depois entra somente com nome e senha.</p></div><Link className="button dark" href="/cozinha" target="_blank">Abrir cozinha</Link></div>
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
      <div className="kitchen-operator-list">{operators.length === 0 ? <div className="empty-state">Nenhum operador cadastrado.</div> : operators.map(operator => <article key={operator.id}><div><span className={`waiter-status status-${operator.status}`}>{operator.status === "active" ? "ATIVO" : operator.status === "blocked" ? "BLOQUEADO" : "INATIVO"}</span><h3>{operator.name}</h3><p>{operator.access_type === "daily" ? `Acesso em ${new Date(`${operator.work_date}T12:00:00`).toLocaleDateString("pt-BR")}` : "Funcionário fixo"} · Pagamento {operator.payment_cycle === "daily" ? "por diária" : operator.payment_cycle === "weekly" ? "semanal" : operator.payment_cycle === "biweekly" ? "quinzenal" : "mensal"} · {operator.device_mode === "dedicated" ? "Tela exclusiva" : "Tela compartilhada"}</p><small>{operator.user_id ? "Senha criada" : "Aguardando criação da senha"}</small></div><div className="waiter-row-actions"><button type="button" onClick={() => beginEdit(operator)}>Editar</button><button type="button" onClick={() => void createInvite(operator)}>{operator.user_id ? "Redefinir senha" : "Gerar acesso"}</button><button type="button" onClick={() => void toggle(operator)}>{operator.status === "active" ? "Bloquear" : "Ativar"}</button><button type="button" className="danger-action" disabled={busy} onClick={() => void removeOperator(operator)}>Excluir</button></div></article>)}</div>
    </div>
    {invite && <div className="waiter-invite-ready"><div><small>{invite.isReset ? "REDEFINIÇÃO PRONTA" : "LINK PRONTO"}</small><h3>Envie para {invite.name}</h3><p>{invite.isReset ? "Ao abrir, a pessoa cria uma nova senha e continua usando o mesmo WhatsApp." : "Ao abrir, a pessoa cria a senha e passa a entrar apenas na cozinha."}</p></div><div className="invite-actions"><a className="button whatsapp" target="_blank" rel="noreferrer" href={`https://wa.me/${normalizeBrazilianPhone(invite.phone)}?text=${encodeURIComponent(whatsappMessage)}`}>Enviar pelo WhatsApp</a><button className="button outline" type="button" onClick={() => void navigator.clipboard.writeText(invite.link)}>Copiar link</button></div></div>}
    {message && <div className={`form-message ${message.includes("excluído") ? "form-success" : ""}`}>{message}</div>}
  </section>;
}
