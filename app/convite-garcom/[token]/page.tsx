import { Brand } from "@/components/ui";
import { WaiterInviteClaim } from "@/components/waiter-access";
export default async function WaiterInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <main className="auth-page waiter-login-page"><aside className="auth-aside"><Brand /><div className="auth-quote"><span className="kicker">BEM-VINDO À EQUIPE</span><h2>Seu trabalho, organizado em uma tela simples.</h2><p>Ative o convite e acesse somente as funções necessárias para o atendimento.</p></div></aside><section className="auth-main"><WaiterInviteClaim token={token} /></section></main>;
}
