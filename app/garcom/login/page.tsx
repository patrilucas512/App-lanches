import { Brand } from "@/components/ui";
import { WaiterLoginForm } from "@/components/waiter-access";
export default async function WaiterLoginPage({ searchParams }: { searchParams: Promise<{ estabelecimento?: string }> }) {
  const query = await searchParams;
  return <main className="auth-page waiter-login-page"><aside className="auth-aside"><Brand /><div className="auth-quote"><span className="kicker">ÁREA DE TRABALHO</span><h2>Mesas, pedidos e pagamentos em poucos toques.</h2><p>Acesso exclusivo para a equipe do estabelecimento.</p></div></aside><section className="auth-main"><div className="auth-card"><h1>Entrar como garçom.</h1><p>Use seu WhatsApp e a senha criada no convite.</p><WaiterLoginForm establishment={query.estabelecimento} /></div></section></main>;
}
