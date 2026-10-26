"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

async function edgeMessage(error: unknown, fallback: string) {
  if (!error || typeof error !== "object" || !("context" in error)) return fallback;
  try { const body = await ((error as { context: Response }).context).clone().json(); return body.error || fallback; } catch { return fallback; }
}

function Password({ name, autoComplete }: { name: string; autoComplete: string }) {
  const [visible, setVisible] = useState(false);
  return <div className="password-input-wrap"><input name={name} type={visible ? "text" : "password"} minLength={8} maxLength={72} required autoComplete={autoComplete} /><button type="button" className="password-visibility" onClick={() => setVisible(value => !value)} aria-label={visible ? "Ocultar senha" : "Mostrar senha"}>{visible ? "◉" : "👁"}</button></div>;
}

export function DriverLoginForm() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name")).trim().replace(/\s+/g, " ");
    if (name.split(" ").length < 2) { setMessage("Informe nome e sobrenome."); setBusy(false); return; }
    const supabase = createClient();
    const response = await supabase.functions.invoke("employee-login", { body: { kind: "driver", name, password: String(form.get("password")) } });
    if (response.error || !response.data?.access_token) { setMessage(response.data?.error || await edgeMessage(response.error, "Nome ou senha inválidos.")); setBusy(false); return; }
    const { error } = await supabase.auth.setSession({ access_token: response.data.access_token, refresh_token: response.data.refresh_token });
    if (error) { setMessage("Não foi possível abrir o sistema de entregas."); setBusy(false); return; }
    window.location.assign("/motoboy");
  }
  return <form className="form" onSubmit={login}><div className="field"><label>NOME E SOBRENOME</label><input name="name" required autoComplete="name" placeholder="Ex.: João da Silva" /></div><div className="field"><label>SENHA</label><Password name="password" autoComplete="current-password" /></div>{message && <div className="form-message">{message}</div>}<button className="button dark wide" disabled={busy}>{busy ? "Entrando..." : "Entrar nas entregas →"}</button><p className="auth-switch">Primeiro acesso? Use o link enviado pelo administrador. <Link href="/">Voltar ao site</Link></p></form>;
}

export function DriverInviteClaim({ token }: { token: string }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const completedKey = `masterapp:driver-access-completed:${token}`;
    if (window.localStorage.getItem(completedKey) !== "1") return;
    void createClient().auth.getSession().then(({ data }) => {
      if (data.session) window.location.replace("/motoboy");
    });
  }, [token]);
  async function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password"));
    if (password !== String(form.get("confirmation"))) { setMessage("As duas senhas precisam ser iguais."); setBusy(false); return; }
    const supabase = createClient();
    const response = await supabase.functions.invoke("activate-driver-access", { body: { token, password } });
    if (response.error || !response.data?.access_token || !response.data?.refresh_token) { setMessage(response.data?.error || await edgeMessage(response.error, "Não foi possível criar o acesso.")); setBusy(false); return; }
    const { error } = await supabase.auth.setSession({ access_token: response.data.access_token, refresh_token: response.data.refresh_token });
    if (error) { setMessage("A senha foi salva, mas não foi possível manter a sessão neste aparelho. Abra o link novamente."); setBusy(false); return; }
    window.localStorage.setItem(`masterapp:driver-access-completed:${token}`, "1");
    setMessage("Acesso ativo. Abrindo suas entregas...");
    window.setTimeout(() => window.location.replace("/motoboy"), 300);
  }
  return <div className="auth-card waiter-invite-card"><span className="kicker">ACESSO DO MOTOBOY</span><h1>Crie sua senha.</h1><p>Você informa a senha somente uma vez. Depois de ativado, o acesso permanece aberto neste aparelho até você tocar em Sair.</p><form className="form" onSubmit={activate}><div className="field"><label>CRIE UMA SENHA</label><Password name="password" autoComplete="new-password" /></div><div className="field"><label>CONFIRME A SENHA</label><Password name="confirmation" autoComplete="new-password" /></div><button className="button dark wide" disabled={busy}>{busy ? "Liberando..." : "Criar senha e abrir entregas →"}</button></form>{message && <div className={message.includes("Acesso ativo") ? "form-message form-success" : "form-message"}>{message}</div>}</div>;
}
