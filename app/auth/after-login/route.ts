import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeLoginNext } from "@/lib/login-next";

// Rota (e não página) porque lê o ?next= direto do endereço da requisição, como /auth/callback.
// Como página, o vinext entregava os parâmetros vazios quando a página só redirecionava.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const go = (path: string) => NextResponse.redirect(new URL(path, url.origin));
  const supabase = await createClient(); const { data: claims } = await supabase.auth.getClaims(); const userId = claims?.claims?.sub; if (!userId) return go("/login");
  const [{ data: profile }, { data: member }] = await Promise.all([supabase.from("profiles").select("is_superadmin").eq("id", userId).single(), supabase.from("establishment_members").select("role").eq("user_id", userId).limit(1).maybeSingle()]);
  await supabase.from("profiles").update({ last_login_at: new Date().toISOString() }).eq("id", userId);
  // Endereço pedido antes do login (?next=): quem abriu /superadmin volta para o superadmin.
  // /superadmin só vale para superadmin; as outras telas conferem o acesso sozinhas.
  const next = safeLoginNext(url.searchParams.get("next"));
  if (next && (!/^\/superadmin(\/|\?|$)/.test(next) || profile?.is_superadmin)) return go(next);
  // O "Entrar" da landing é a porta dos clientes: quem tem loja cai sempre na loja,
  // mesmo sendo superadmin. O Super Admin fica em /superadmin (protegido por is_superadmin).
  if (member?.role === "attendant") return go("/garcom/app");
  if (member?.role === "kitchen") return go("/cozinha");
  if (!member && profile?.is_superadmin) return go("/superadmin/dashboard");
  return go("/home");
}
