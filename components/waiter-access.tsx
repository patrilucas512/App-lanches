"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

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

function saoPauloDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function PasswordInput({
  name,
  autoComplete,
  minLength,
}: {
  name: string;
  autoComplete: string;
  minLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  return <div className="password-input-wrap">
    <input
      name={name}
      type={visible ? "text" : "password"}
      minLength={minLength}
      required
      autoComplete={autoComplete}
    />
    <button
      type="button"
      className="password-visibility"
      aria-label={visible ? "Ocultar senha" : "Visualizar senha"}
      aria-pressed={visible}
      title={visible ? "Ocultar senha" : "Visualizar senha"}
      onClick={() => setVisible((current) => !current)}
    >
      {visible ? "◉" : "👁"}
    </button>
  </div>;
}

export function WaiterLoginForm({ establishment }: { establishment?: string }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name")).trim().replace(/\s+/g, " ");
    if (name.split(" ").length < 2) {
      setMessage("Informe seu nome e sobrenome.");
      setBusy(false);
      return;
    }

    const supabase = createClient();
    const { data, error } = await supabase.functions.invoke("employee-login", {
      body: { kind: "waiter", name, password: String(form.get("password")), establishment },
    });
    if (error || !data?.access_token || !data?.refresh_token) {
      setMessage(data?.error || await functionErrorMessage(error, "Nome ou senha inválidos."));
      setBusy(false);
      return;
    }
    const { error: sessionError } = await supabase.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
    if (sessionError) { setMessage("Não foi possível abrir seu acesso agora."); setBusy(false); return; }
    window.location.assign("/garcom/app");
  }

  return <form className="form" onSubmit={login}>
    <div className="field">
      <label>NOME E SOBRENOME</label>
      <input
        name="name"
        type="text"
        required
        autoComplete="name"
        placeholder="Ex.: Jonathan Perrone"
      />
    </div>
    <div className="field">
      <label>SENHA</label>
      <PasswordInput name="password" autoComplete="current-password" />
    </div>
    {message && <div className="form-message">{message}</div>}
    <button className="button dark wide" disabled={busy}>
      {busy ? "Entrando..." : "Entrar para trabalhar →"}
    </button>
    <button type="button" className="auth-recovery-link auth-recovery-button" onClick={() => setMessage("Peça ao administrador para abrir Equipe, tocar em Redefinir senha e enviar um novo link pelo WhatsApp.")}>Esqueci minha senha</button>
    <p className="auth-switch">
      Primeiro acesso? Abra o link recebido no WhatsApp e crie sua senha. Depois, entre somente com seu nome e senha.
    </p>
  </form>;
}

export function WaiterInviteClaim({ token }: { token: string }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password"));
    const confirmation = String(form.get("password_confirmation"));
    if (password.length < 8) {
      setMessage("A senha precisa ter pelo menos 8 caracteres.");
      setBusy(false);
      return;
    }
    if (password !== confirmation) {
      setMessage("As duas senhas precisam ser iguais.");
      setBusy(false);
      return;
    }

    const supabase = createClient();
    const { data, error } = await supabase.functions.invoke("activate-waiter-access", {
      body: { token, password },
    });
    if (error || !data?.login_email) {
      setMessage(data?.error || await functionErrorMessage(error, "Não foi possível redefinir este acesso. Peça um novo link ao administrador."));
      setBusy(false);
      return;
    }

    const { error: loginError } = await supabase.auth.signInWithPassword({
      email: data.login_email,
      password,
    });
    if (loginError) {
      setMessage("Senha criada. Entre usando seu nome completo e essa senha.");
      setBusy(false);
      return;
    }

    if (data.employment_type === "daily" && data.work_date !== saoPauloDate()) {
      await supabase.auth.signOut();
      const formattedDate = new Date(`${data.work_date}T12:00:00`).toLocaleDateString("pt-BR");
      setMessage(`Senha criada. Seu acesso de diarista estará liberado em ${formattedDate}.`);
      setBusy(false);
      return;
    }

    setMessage("Acesso ativado. Abrindo sua área de trabalho...");
    window.setTimeout(() => window.location.assign("/garcom/app"), 500);
  }

  return <div className="auth-card waiter-invite-card">
    <span className="kicker">ACESSO DA EQUIPE</span>
    <h1>Crie sua senha.</h1>
      <p>Seu cadastro já foi autorizado. Escolha uma senha para acessar sua área de trabalho.</p>
    <form className="form" onSubmit={activate}>
      <div className="field">
        <label>CRIE UMA SENHA</label>
        <PasswordInput name="password" minLength={8} autoComplete="new-password" />
      </div>
      <div className="field">
        <label>CONFIRME A SENHA</label>
        <PasswordInput name="password_confirmation" minLength={8} autoComplete="new-password" />
      </div>
      <button className="button dark wide" disabled={busy}>
        {busy ? "Liberando acesso..." : "Criar senha e começar →"}
      </button>
      <p className="auth-switch">
        Já criou sua senha? <Link href="/garcom/login">Entrar com nome e senha</Link>
      </p>
    </form>
    {message && <div className={message.includes("ativado") || message.includes("Senha criada")
      ? "form-message form-success"
      : "form-message"}>{message}</div>}
  </div>;
}
