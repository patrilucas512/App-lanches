import { Brand } from "@/components/ui";
import { CashierLoginForm } from "@/components/cashier-access";
export default function CashierLoginPage(){return <main className="auth-page"><section className="auth-panel"><Brand/><div className="auth-card"><span className="kicker">ACESSO DO FUNCIONÁRIO</span><h1>Entrar no caixa.</h1><p>Use seu nome completo e a senha cadastrada.</p><CashierLoginForm/></div></section><aside className="auth-art"><span>CAIXA · VENDAS · CONFERÊNCIA</span><h2>Cada operação,<br/><em>um responsável.</em></h2></aside></main>}
