"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

async function edgeMessage(error: unknown, fallback: string) {
  if (!error || typeof error !== "object" || !("context" in error)) return fallback;
  try { const body = await ((error as { context: Response }).context).clone().json(); return body.error || fallback; } catch { return fallback; }
}

function Password({ name, autoComplete }: { name: string; autoComplete: string }) {
  const [visible, setVisible] = useState(false);
  return <div className="password-input-wrap"><input name={name} type={visible ? "text" : "password"} minLength={8} required autoComplete={autoComplete} /><button type="button" className="password-visibility" onClick={() => setVisible(value => !value)} aria-label={visible ? "Ocultar senha" : "Mostrar senha"}>{visible ? "◉" : "👁"}</button></div>;
}

export function CashierLoginForm() {
  const [message,setMessage]=useState(""); const [busy,setBusy]=useState(false);
  async function login(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setMessage("");const form=new FormData(event.currentTarget);const name=String(form.get("name")).trim().replace(/\s+/g," ");if(name.split(" ").length<2){setMessage("Informe nome e sobrenome.");setBusy(false);return;}const supabase=createClient();const response=await supabase.functions.invoke("employee-login",{body:{kind:"cashier",name,password:String(form.get("password"))}});if(response.error||!response.data?.access_token){setMessage(response.data?.error||await edgeMessage(response.error,"Nome ou senha inválidos."));setBusy(false);return;}const {error}=await supabase.auth.setSession({access_token:response.data.access_token,refresh_token:response.data.refresh_token});if(error){setMessage("Não foi possível abrir o caixa.");setBusy(false);return;}window.location.assign("/caixa");}
  return <form className="form" onSubmit={login}><div className="field"><label>NOME E SOBRENOME</label><input name="name" required autoComplete="name" placeholder="Ex.: Maria da Silva" /></div><div className="field"><label>SENHA</label><Password name="password" autoComplete="current-password" /></div>{message&&<div className="form-message">{message}</div>}<button className="button dark wide" disabled={busy}>{busy?"Entrando...":"Entrar e abrir o caixa →"}</button><p className="auth-switch">Primeiro acesso? Use o link enviado pelo administrador. <Link href="/">Voltar ao site</Link></p></form>;
}

export function CashierInviteClaim({token}:{token:string}){
  const [message,setMessage]=useState("");const [busy,setBusy]=useState(false);
  async function activate(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setMessage("");const form=new FormData(event.currentTarget);const password=String(form.get("password"));if(password!==String(form.get("confirmation"))){setMessage("As duas senhas precisam ser iguais.");setBusy(false);return;}const supabase=createClient();const response=await supabase.functions.invoke("activate-cashier-access",{body:{token,password}});if(response.error||!response.data?.login_email){setMessage(response.data?.error||await edgeMessage(response.error,"Não foi possível criar o acesso."));setBusy(false);return;}const {error}=await supabase.auth.signInWithPassword({email:response.data.login_email,password});if(error){setMessage("Senha criada. Entre com nome e senha.");setBusy(false);return;}window.location.replace("/caixa");}
  return <div className="auth-card waiter-invite-card"><span className="kicker">ACESSO AO CAIXA</span><h1>Crie sua senha.</h1><p>Depois disso, todas as operações realizadas ficarão registradas no seu nome.</p><form className="form" onSubmit={activate}><div className="field"><label>CRIE UMA SENHA</label><Password name="password" autoComplete="new-password" /></div><div className="field"><label>CONFIRME A SENHA</label><Password name="confirmation" autoComplete="new-password" /></div><button className="button dark wide" disabled={busy}>{busy?"Liberando...":"Criar senha e abrir caixa →"}</button></form>{message&&<div className="form-message">{message}</div>}</div>;
}
