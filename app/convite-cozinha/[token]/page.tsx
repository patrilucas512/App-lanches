import { Brand } from "@/components/ui";
import { KitchenInviteClaim } from "@/components/kitchen-access";

export default async function KitchenInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <main className="auth-page waiter-login-page"><aside className="auth-aside"><Brand /><div className="auth-quote"><span className="kicker">BEM-VINDO À COZINHA</span><h2>Uma tela simples para receber, imprimir e preparar.</h2><p>Crie sua senha uma vez e comece a operação.</p></div></aside><section className="auth-main"><KitchenInviteClaim token={token} /></section></main>;
}
