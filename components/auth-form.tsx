"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export function AuthForm({ mode, notice = "" }: { mode: "login" | "signup"; notice?: string }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    const data = new FormData(event.currentTarget);
    try {
      const supabase = createClient();
      if (mode === "signup") {
        const password = String(data.get("password"));
        const email = String(data.get("email")).trim().toLowerCase();
        const emailConfirmation = String(data.get("email_confirmation")).trim().toLowerCase();
        if (password.length < 8) throw new Error("A senha precisa ter pelo menos 8 caracteres.");
        if (email !== emailConfirmation) throw new Error("Os dois endereços de e-mail precisam ser iguais.");
        const redirectOrigin = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
        const { data: signup, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: String(data.get("name") ?? ""), phone: String(data.get("phone") ?? "") },
            emailRedirectTo: `${redirectOrigin}/auth/callback?next=/onboarding`,
          },
        });
        if (error) throw error;
        if (signup.session) {
          window.location.assign("/onboarding");
          return;
        }
        setMessage(`Enviamos a confirmação para ${email}. Confira também a pasta de spam.`);
      } else {
        const email=String(data.get("email")).trim().toLowerCase();
        const preflight=await fetch("/api/security/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email})});
        const guard=await preflight.json();
        if(!preflight.ok)throw new Error(guard.error||"Acesso temporariamente limitado.");
        if(Number(guard.delay_ms)>0)await new Promise(resolve=>setTimeout(resolve,Number(guard.delay_ms)));
        const { error } = await supabase.auth.signInWithPassword({ email, password: String(data.get("password")) });
        if (error) throw error;
        await fetch("/api/security/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,success:true})});
        const{data:aal}=await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if(aal?.nextLevel==="aal2"&&aal.currentLevel!=="aal2"){window.location.assign("/auth/mfa");return;}
        setMessage("Login realizado. Abrindo sua área...");
        window.location.assign("/auth/after-login");
        return;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      setMessage(detail === "Invalid login credentials" ? "E-mail ou senha inválidos." : detail || "Não foi possível continuar.");
    } finally { setLoading(false); }
  }

  return <form className="form" onSubmit={submit}>
    {mode === "signup" && <>
      <div className="field"><label>NOME COMPLETO</label><input name="name" autoComplete="name" required placeholder="Como podemos chamar você?" /></div>
      <div className="field"><label>WHATSAPP</label><input name="phone" autoComplete="tel" required placeholder="(11) 99999-9999" /></div>
    </>}
    <div className="field"><label>{mode === "signup" ? "SEU E-MAIL DE ACESSO" : "E-MAIL"}</label><input name="email" type="email" autoComplete="email" required placeholder="seunome@gmail.com" /></div>
    {mode === "signup" && <div className="field"><label>CONFIRME O E-MAIL</label><input name="email_confirmation" type="email" autoComplete="email" required placeholder="Digite novamente o mesmo e-mail" /><small>Use um endereço que você consegue abrir agora.</small></div>}
    <div className="field"><label>SENHA</label><div className="password-input-wrap"><input name="password" type={passwordVisible ? "text" : "password"} minLength={8} autoComplete={mode === "signup" ? "new-password" : "current-password"} required placeholder="Mínimo de 8 caracteres" /><button type="button" className="password-visibility" aria-label={passwordVisible ? "Ocultar senha" : "Visualizar senha"} onClick={() => setPasswordVisible(value => !value)}>{passwordVisible ? "◉" : "👁"}</button></div></div>
    {mode === "login" && <Link className="auth-recovery-link" href="/recuperar-senha">Esqueci minha senha</Link>}
    {(message || notice) && <div className={`form-message ${(notice || message.startsWith("Enviamos") || message.startsWith("Login realizado")) ? "form-success" : ""}`}>{message || notice}</div>}
    <button type="submit" className="button dark wide" disabled={loading}>{loading ? "Aguarde..." : mode === "signup" ? "Criar conta grátis →" : "Entrar no painel →"}</button>
    {mode === "login" && <Link className="auth-recovery-link" href="/auth/sso">Entrar com SSO corporativo</Link>}
    <p className="auth-switch">{mode === "signup" ? <>Já tem uma conta? <Link href="/login">Entrar</Link></> : <>Ainda não usa o MasterApp? <Link href="/cadastro">Começar grátis</Link></>}</p>
  </form>;
}
