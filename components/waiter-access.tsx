"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

function normalizeBrazilianPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) return `+${digits}`;
  return value.startsWith("+") ? `+${digits}` : digits;
}

export function WaiterLoginForm({ establishment }: { establishment?: string }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const supabase = createClient();
    const phone = normalizeBrazilianPhone(String(form.get("phone")));
    const { error } = await supabase.auth.signInWithPassword({
      phone,
      password: String(form.get("password")),
    });
    if (error) {
      setMessage("WhatsApp ou senha inválidos.");
    } else {
      const userId = (await supabase.auth.getUser()).data.user?.id;
      const { data: waiter } = await supabase.from("waiters").select("status,active_now").eq("user_id", userId).maybeSingle();
      if (!waiter || ["inactive","paused","blocked"].includes(waiter.status) || !waiter.active_now) {
        await supabase.auth.signOut();
        setMessage("Seu acesso está inativo. Fale com o administrador.");
      } else {
        window.location.assign("/garcom/app");
      }
    }
    setBusy(false);
  }

  return <form className="form" onSubmit={login}>
    <div className="field"><label>ESTABELECIMENTO</label><input value={establishment || ""} readOnly={Boolean(establishment)} name="establishment" placeholder="Nome ou link do estabelecimento" /></div>
    <div className="field"><label>SEU WHATSAPP</label><input name="phone" type="tel" inputMode="tel" required autoComplete="tel" placeholder="(21) 98139-2823" /></div>
    <div className="field"><label>SENHA</label><input name="password" type="password" required autoComplete="current-password" /></div>
    {message && <div className="form-message">{message}</div>}
    <button className="button dark wide" disabled={busy}>{busy ? "Entrando..." : "Entrar para trabalhar →"}</button>
    <p className="auth-switch">Primeiro acesso? Abra o link recebido no WhatsApp e crie sua senha.</p>
  </form>;
}

export function WaiterInviteClaim({ token }: { token: string }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password"));
    const confirmation = String(form.get("password_confirmation"));
    if (password.length < 8) {
      setMessage("A senha precisa ter pelo menos 8 caracteres."); setBusy(false); return;
    }
    if (password !== confirmation) {
      setMessage("As duas senhas precisam ser iguais."); setBusy(false); return;
    }

    const supabase = createClient();
    const { data, error } = await supabase.functions.invoke("activate-waiter-access", {
      body: { token, password },
    });
    if (error || !data?.phone) {
      setMessage(data?.error || "Não foi possível ativar o acesso. Peça um novo convite ao administrador.");
      setBusy(false);
      return;
    }

    const { error: loginError } = await supabase.auth.signInWithPassword({
      phone: data.phone,
      password,
    });
    if (loginError) {
      setMessage("Senha criada. Entre novamente usando seu WhatsApp.");
      setBusy(false);
      return;
    }

    setMessage("Acesso ativado. Abrindo sua área de trabalho...");
    window.setTimeout(() => window.location.assign("/garcom/app"), 500);
  }

  return <div className="auth-card waiter-invite-card">
    <span className="kicker">CONVITE DA EQUIPE</span>
    <h1>Crie sua senha.</h1>
    <p>Seu WhatsApp já foi cadastrado pelo administrador. Escolha uma senha e comece a trabalhar.</p>
    <form className="form" onSubmit={activate}>
      <div className="field"><label>CRIE UMA SENHA</label><input name="password" type="password" minLength={8} required autoComplete="new-password" /></div>
      <div className="field"><label>CONFIRME A SENHA</label><input name="password_confirmation" type="password" minLength={8} required autoComplete="new-password" /></div>
      <button className="button dark wide" disabled={busy}>{busy ? "Liberando acesso..." : "Criar senha e começar →"}</button>
      <p className="auth-switch">Já criou sua senha? <Link href="/garcom/login">Entrar com WhatsApp</Link></p>
    </form>
    {message && <div className={message.includes("ativado") ? "form-message form-success" : "form-message"}>{message}</div>}
  </div>;
}
