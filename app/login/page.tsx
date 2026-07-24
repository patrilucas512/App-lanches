import { AuthForm } from "@/components/auth-form";
import { ResendConfirmation } from "@/components/resend-confirmation";
import { Brand } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims?.sub) redirect("/painel");

  return <main className="auth-page"><aside className="auth-aside"><Brand /><div className="auth-quote"><span className="kicker">BEM-VINDO DE VOLTA</span><h2>Seu negócio não para. Seu painel também não.</h2><p>Acompanhe pedidos, atualize o cardápio e veja o desempenho do seu restaurante em um só lugar.</p></div><small>© 2026 Mesa Viva</small></aside><section className="auth-main"><div className="auth-card"><h1>Entre na sua conta.</h1><p>Use os dados cadastrados para acessar seu estabelecimento.</p><AuthForm mode="login" /><ResendConfirmation /></div></section></main>;
}
