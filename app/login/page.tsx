import { AuthForm } from "@/components/auth-form";
import { ResendConfirmation } from "@/components/resend-confirmation";
import { Brand } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { safeLoginNext } from "@/lib/login-next";
import { LoggedInRedirect } from "@/components/logged-in-redirect";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ senha?: string; erro?: string; next?: string }> }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  // Já logado: segue para o endereço pedido (ex.: /superadmin/planos) ou para o painel.
  if (data?.claims?.sub) return <LoggedInRedirect />;
  const params = await searchParams;
  // ?next= guarda o endereço pedido antes do login.
  const next = safeLoginNext(params.next);
  // /auth/callback sends here when the confirmation link was opened in another browser or device.
  const notice = params.senha === "alterada" ? "Senha alterada com sucesso. Entre com sua nova senha."
    : params.erro === "confirmacao" ? "Não conseguimos concluir a confirmação neste navegador. Se você já clicou no link do e-mail, entre com seu e-mail e senha abaixo; se não funcionar, peça um novo e-mail de confirmação."
    : "";

  return <main className="auth-page"><aside className="auth-aside"><Brand /><div className="auth-quote"><span className="kicker">BEM-VINDO DE VOLTA</span><h2>Seu negócio não para. Seu painel também não.</h2><p>Acompanhe pedidos, atualize o cardápio e veja o desempenho do seu restaurante em um só lugar.</p></div><small>© 2026 MasterApp</small></aside><section className="auth-main"><div className="auth-card"><h1>Entre na sua conta.</h1><p>Use os dados cadastrados para acessar seu estabelecimento.</p><AuthForm mode="login" notice={notice} next={next} /><ResendConfirmation /></div></section></main>;
}
