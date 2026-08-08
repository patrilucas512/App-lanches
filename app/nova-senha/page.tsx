import { Brand } from "@/components/ui";
import { UpdatePassword } from "@/components/password-recovery";

export default function NewPasswordPage() {
  return <main className="auth-page"><aside className="auth-aside"><Brand /><div className="auth-quote"><span className="kicker">ACESSO SEGURO</span><h2>Escolha uma nova senha.</h2><p>Use o botão de visualização para conferir a senha antes de salvá-la.</p></div><small>© 2026 Mesa Viva</small></aside><section className="auth-main"><div className="auth-card"><h1>Crie sua nova senha.</h1><p>Digite a mesma senha nos dois campos.</p><UpdatePassword /></div></section></main>;
}
