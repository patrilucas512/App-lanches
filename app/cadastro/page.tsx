import { AuthForm } from "@/components/auth-form";
import { Brand } from "@/components/ui";

export default function SignupPage() {
  return <main className="auth-page"><aside className="auth-aside"><Brand /><div className="auth-quote"><span className="kicker">14 DIAS GRÁTIS</span><h2>Seu cardápio merece uma experiência à altura.</h2><p>Sem cartão de crédito. Configure sua loja, convide sua equipe e comece a receber pedidos.</p></div><small>Mais venda. Menos complicação.</small></aside><section className="auth-main"><div className="auth-card"><h1>Crie sua conta.</h1><p>Leva menos de dois minutos para começar.</p><AuthForm mode="signup" /></div></section></main>;
}
