"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

function PasswordField({ name, label }: { name: string; label: string }) {
  const [visible, setVisible] = useState(false);
  return <div className="field">
    <label>{label}</label>
    <div className="password-input-wrap">
      <input name={name} type={visible ? "text" : "password"} minLength={8} autoComplete="new-password" required placeholder="Mínimo de 8 caracteres" />
      <button className="password-visibility" type="button" onClick={() => setVisible((value) => !value)} aria-label={visible ? "Ocultar senha" : "Visualizar senha"} title={visible ? "Ocultar senha" : "Visualizar senha"}>{visible ? "◉" : "◎"}</button>
    </div>
  </div>;
}

export function RequestPasswordRecovery({ initialEmail = "" }: { initialEmail?: string }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    const email = String(new FormData(event.currentTarget).get("email")).trim().toLowerCase();
    try {
      const supabase = createClient();
      const redirectOrigin = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${redirectOrigin}/auth/callback?next=/nova-senha`,
      });
      if (error) throw error;
      setMessage(`Enviamos um link de recuperação para ${email}. Confira também a pasta de spam.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível enviar o link agora.");
    } finally {
      setLoading(false);
    }
  }

  return <form className="form" onSubmit={submit}>
    <div className="field"><label>E-MAIL DE ACESSO</label><input name="email" type="email" autoComplete="email" required defaultValue={initialEmail} placeholder="seunome@gmail.com" /></div>
    {message && <div className="form-message form-success">{message}</div>}
    <button type="submit" className="button dark wide" disabled={loading}>{loading ? "Enviando..." : "Enviar link de recuperação →"}</button>
    <p className="auth-switch"><Link href="/login">Voltar para o login</Link></p>
  </form>;
}

export function UpdatePassword() {
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("Validando seu link de recuperação...");

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setReady(true);
        setMessage("");
      } else {
        setMessage("Este link expirou ou já foi usado. Solicite um novo link.");
      }
    });
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password"));
    const confirmation = String(data.get("password_confirmation"));
    if (password.length < 8) {
      setMessage("A senha precisa ter pelo menos 8 caracteres.");
      setLoading(false);
      return;
    }
    if (password !== confirmation) {
      setMessage("As duas senhas precisam ser iguais.");
      setLoading(false);
      return;
    }
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }
    await supabase.auth.signOut();
    window.location.assign("/login?senha=alterada");
  }

  return <form className="form" onSubmit={submit}>
    <PasswordField name="password" label="NOVA SENHA" />
    <PasswordField name="password_confirmation" label="CONFIRME A NOVA SENHA" />
    {message && <div className="form-message">{message}</div>}
    <button type="submit" className="button dark wide" disabled={!ready || loading}>{loading ? "Salvando..." : "Salvar nova senha →"}</button>
    {!ready && <p className="auth-switch"><Link href="/recuperar-senha">Solicitar outro link</Link></p>}
  </form>;
}
