"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export function WaiterLoginForm({ establishment }: { establishment?: string }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget); const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email: String(form.get("email")), password: String(form.get("password")) });
    if (error) setMessage("E-mail ou senha inválidos.");
    else {
      const { data: waiter } = await supabase.from("waiters").select("status,active_now").eq("user_id", (await supabase.auth.getUser()).data.user?.id).maybeSingle();
      if (!waiter || ["inactive","paused","blocked"].includes(waiter.status) || !waiter.active_now) {
        await supabase.auth.signOut(); setMessage("Seu acesso está inativo. Fale com o administrador.");
      } else window.location.assign("/garcom/app");
    }
    setBusy(false);
  }
  return <form className="form" onSubmit={login}>
    <div className="field"><label>ESTABELECIMENTO</label><input value={establishment || ""} readOnly={Boolean(establishment)} name="establishment" placeholder="Nome ou link do estabelecimento" /></div>
    <div className="field"><label>E-MAIL DE ACESSO</label><input name="email" type="email" required autoComplete="email" /></div>
    <div className="field"><label>SENHA</label><input name="password" type="password" required autoComplete="current-password" /></div>
    {message && <div className="form-message">{message}</div>}
    <button className="button dark wide" disabled={busy}>{busy ? "Entrando..." : "Entrar para trabalhar →"}</button>
    <p className="auth-switch">Primeiro acesso? Abra o link de convite enviado pelo administrador.</p>
  </form>;
}

export function WaiterInviteClaim({ token }: { token: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { void supabase.auth.getUser().then(({ data }) => setUser(data.user?.email || null)); }, [supabase]);
  async function claim() {
    setBusy(true); const { error } = await supabase.rpc("claim_waiter_invite", { requested_token: token });
    if (error) setMessage(error.message); else { setMessage("Acesso ativado. Abrindo sua área de trabalho..."); window.setTimeout(() => window.location.assign("/garcom/app"), 800); }
    setBusy(false);
  }
  async function signup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); const form = new FormData(event.currentTarget);
    const email = String(form.get("email")).trim().toLowerCase(); const password = String(form.get("password"));
    if (password.length < 8) { setMessage("A senha precisa ter pelo menos 8 caracteres."); setBusy(false); return; }
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { data: { full_name: String(form.get("name")) }, emailRedirectTo: `${window.location.origin}/auth/callback?next=/convite-garcom/${token}` },
    });
    if (error) setMessage(error.message);
    else if (data.session) { setUser(email); setMessage("Conta criada. Confirme o vínculo abaixo."); }
    else setMessage(`Confirme o e-mail enviado para ${email} e volte a este convite.`);
    setBusy(false);
  }
  return <div className="auth-card waiter-invite-card"><span className="kicker">CONVITE DA EQUIPE</span><h1>Seu acesso de garçom.</h1><p>Crie sua senha no primeiro acesso. Este convite é individual e temporário.</p>
    {user ? <div className="invite-confirm"><b>Conta identificada</b><span>{user}</span><button className="button dark wide" onClick={claim} disabled={busy}>Ativar meu acesso →</button></div> :
    <form className="form" onSubmit={signup}><div className="field"><label>SEU NOME</label><input name="name" required /></div><div className="field"><label>E-MAIL DO CONVITE</label><input name="email" type="email" required /></div><div className="field"><label>CRIE UMA SENHA</label><input name="password" type="password" minLength={8} required /></div><button className="button dark wide" disabled={busy}>Criar acesso seguro</button><p className="auth-switch">Já criou a conta? <Link href={`/garcom/login?convite=${token}`}>Entrar</Link></p></form>}
    {message && <div className={message.includes("ativado") || message.includes("enviado") ? "form-message form-success" : "form-message"}>{message}</div>}
  </div>;
}
