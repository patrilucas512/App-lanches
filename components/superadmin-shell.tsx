"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
// Fase 99F: regras usadas só no painel e no superadmin (fora do globals.css)
import "@/app/painel/dashboard.css";

const links = [
  ["/superadmin/dashboard", "▦", "Painel"],
  ["/superadmin/centro-de-comando", "◉", "Centro de comando"],
  ["/superadmin/analytics", "⌁", "Análise de dados"],
  ["/superadmin/executivo", "◫", "Executivo"],
  ["/superadmin/operacoes-internas", "▣", "Operações internas"],
  ["/superadmin/estabelecimentos", "⌂", "Estabelecimentos"],
  ["/superadmin/clientes", "◎", "Clientes e usuários"],
  ["/superadmin/onboarding", "✓", "Primeiros passos"],
  ["/superadmin/assinaturas", "◇", "Assinaturas"],
  ["/superadmin/billing", "▥", "Cobrança"],
  ["/superadmin/planos", "▤", "Planos"],
  ["/superadmin/apps", "⌘", "Apps para revisão"],
  ["/superadmin/pagamentos", "$", "Pagamentos"],
  ["/superadmin/cupons", "%", "Cupons"],
  ["/superadmin/suporte", "?", "Suporte"],
  ["/superadmin/avisos", "!", "Avisos"],
  ["/superadmin/piloto", "◎", "Painel do piloto"],
  ["/superadmin/alertas", "⚠", "Alertas do piloto"],
  ["/superadmin/logs", "≡", "Auditoria"],
  ["/superadmin/seguranca", "◈", "Segurança"],
  ["/superadmin/performance", "⌁", "Desempenho"],
  ["/superadmin/qualidade", "✓", "Qualidade"],
  ["/superadmin/feature-management", "⚑", "Gestão de funções"],
  ["/superadmin/finops", "◒", "Custos da plataforma"],
  ["/superadmin/politicas", "⌘", "Políticas e regras"],
  ["/superadmin/ia-agentes", "✦", "IA e Agentes"],
  ["/superadmin/busca", "⌕", "Saúde da busca"],
  ["/superadmin/produto", "◉", "Produto"],
  ["/superadmin/growth", "↗", "Crescimento"],
  ["/superadmin/customer-success", "♥", "Sucesso do cliente"],
  ["/superadmin/vendas", "◆", "Vendas / CRM"],
  ["/superadmin/relatorios", "↗", "Relatórios"],
  ["/superadmin/configuracoes", "⚙", "Configurações"],
] as const;

export function SuperadminShell({ children, name }: { children: React.ReactNode; name: string }) {
  const pathname = usePathname();
  return <main className="sa-app">
    <aside className="sa-sidebar">
      <Link href="/superadmin/dashboard" className="sa-brand"><span>S</span><div><b>MasterApp</b><small>Super Administrador</small></div></Link>
      <nav>{links.map(([href, icon, label]) => <Link key={href} href={href} className={pathname === href || (href.includes("estabelecimentos") && pathname.startsWith(href + "/")) ? "active" : ""}><i>{icon}</i><span>{label}</span></Link>)}</nav>
      <footer><div className="sa-user"><span>{name.slice(0, 2).toUpperCase()}</span><div><b>{name || "Super Admin"}</b><small>Acesso global protegido</small></div></div><Link href="/painel">Abrir painel da minha loja</Link><Link href="/">Sair da área</Link></footer>
    </aside>
    <section className="sa-main"><header className="sa-topbar"><div><b>Central da plataforma</b><small>Dados reais em tempo real</small></div><Link href="/superadmin/configuracoes">Configurações globais</Link></header><div className="sa-content">{children}</div></section>
  </main>;
}
