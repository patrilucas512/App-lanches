import { Brand } from "@/components/ui";
import { RequestPasswordRecovery } from "@/components/password-recovery";

export default async function RecoverPasswordPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const query = await searchParams;
  return <main className="auth-page"><aside className="auth-aside"><Brand /><div className="auth-quote"><span className="kicker">RECUPERE SEU ACESSO</span><h2>Volte ao comando do seu negócio.</h2><p>Enviaremos um link seguro para você escolher uma nova senha.</p></div><small>© 2026 Mesa Viva</small></aside><section className="auth-main"><div className="auth-card"><h1>Esqueceu a senha?</h1><p>Informe o mesmo e-mail usado no cadastro.</p><RequestPasswordRecovery initialEmail={query.email || ""} /></div></section></main>;
}
