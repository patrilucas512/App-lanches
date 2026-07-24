"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function ResendConfirmation() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    const email = String(new FormData(event.currentTarget).get("resend_email")).trim().toLowerCase();
    try {
      const supabase = createClient();
      const redirectOrigin = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: `${redirectOrigin}/auth/callback?next=/onboarding` },
      });
      if (error) throw error;
      setMessage(`Se a conta existir, uma nova confirmação será enviada para ${email}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível reenviar agora.");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return <button className="auth-text-button" type="button" onClick={() => setOpen(true)}>Não recebeu o e-mail de acesso?</button>;

  return <form className="resend-form" onSubmit={resend}>
    <div className="field"><label>E-MAIL USADO NO CADASTRO</label><input name="resend_email" type="email" required placeholder="seunome@gmail.com" /></div>
    <button className="button outline wide" disabled={loading}>{loading ? "Enviando..." : "Reenviar confirmação"}</button>
    {message && <div className="form-message form-success">{message}</div>}
  </form>;
}
