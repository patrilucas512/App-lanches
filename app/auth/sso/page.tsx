"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function SSOLoginPage() {
  const [message,setMessage]=useState(""); const [busy,setBusy]=useState(false);
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setMessage("");const form=new FormData(event.currentTarget);const domain=String(form.get("domain")||"").trim().toLowerCase();const supabase=createClient();const{error}=await supabase.auth.signInWithSSO({domain,options:{redirectTo:`${window.location.origin}/auth/callback?next=/auth/after-login`}});if(error){setMessage(error.message);setBusy(false);}}
  return <main className="security-auth-page"><section><small>ACESSO ENTERPRISE</small><h1>Entrar com SSO</h1><p>Use o domínio corporativo configurado pela sua empresa. Nenhuma função administrativa é concedida automaticamente.</p><form onSubmit={submit}><label>Domínio da empresa<input name="domain" placeholder="empresa.com.br" required/></label><button disabled={busy}>{busy?"Redirecionando…":"Continuar com SSO →"}</button></form>{message&&<p role="alert">{message}</p>}<Link href="/login">Voltar ao login</Link></section></main>;
}
