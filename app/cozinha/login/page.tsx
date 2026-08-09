import { Brand } from "@/components/ui";
import { KitchenLoginForm } from "@/components/kitchen-access";

export default function KitchenLoginPage() {
  return <main className="auth-page waiter-login-page"><aside className="auth-aside"><Brand /><div className="auth-quote"><span className="kicker">OPERAÇÃO DA COZINHA</span><h2>Pedidos, preparo e impressão em uma tela exclusiva.</h2><p>Este acesso não abre as configurações nem o painel administrativo.</p></div></aside><section className="auth-main"><div className="auth-card"><h1>Entrar na cozinha.</h1><p>Use o WhatsApp cadastrado pelo administrador e sua senha.</p><KitchenLoginForm /></div></section></main>;
}
