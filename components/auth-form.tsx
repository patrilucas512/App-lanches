"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    const data = new FormData(event.currentTarget);
    try {
      const supabase = createClient();
      if (mode === "signup") {
        const password = String(data.get("password"));
        if (password.length < 8) throw new Error("A senha precisa ter pelo menos 8 caracteres.");
        const { error } = await supabase.auth.signUp({
          email: String(data.get("email")),
          password,
          options: {
            data: { full_name: String(data.get("name") ?? ""), phone: String(data.get("phone") ?? "") },
            emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
          },
        });
        if (error) throw error;
        setMessage("Conta criada. Confira seu e-mail para confirmar o acesso.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: String(data.get("email")), password: String(data.get("password")) });
        if (error) throw error;
        router.push("/painel");
        router.refresh();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível continuar.");
    } finally { setLoading(false); }
  }

  return <form className="form" onSubmit={submit}>
    {mode === "signup" && <>
      <div className="field"><label>NOME COMPLETO</label><input name="name" autoComplete="name" required placeholder="Como podemos chamar você?" /></div>
      <div className="field"><label>WHATSAPP</label><input name="phone" autoComplete="tel" required placeholder="(11) 99999-9999" /></div>
    </>}
    <div className="field"><label>E-MAIL</label><input name="email" type="email" autoComplete="email" required placeholder="voce@restaurante.com.br" /></div>
    <div className="field"><label>SENHA</label><input name="password" type="password" minLength={8} autoComplete={mode === "signup" ? "new-password" : "current-password"} required placeholder="Mínimo de 8 caracteres" /></div>
    {message && <div className={`form-message ${message.startsWith("Conta") ? "form-success" : ""}`}>{message}</div>}
    <button className="button dark wide" disabled={loading}>{loading ? "Aguarde..." : mode === "signup" ? "Criar conta grátis →" : "Entrar no painel →"}</button>
    <p className="auth-switch">{mode === "signup" ? <>Já tem uma conta? <Link href="/login">Entrar</Link></> : <>Ainda não usa o Mesa Viva? <Link href="/cadastro">Começar grátis</Link></>}</p>
  </form>;
}
