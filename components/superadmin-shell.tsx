"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["/superadmin/dashboard", "▦", "Dashboard"],
  ["/superadmin/centro-de-comando", "◉", "Centro de Comando"],
  ["/superadmin/analytics", "⌁", "Analytics & Dados"],
  ["/superadmin/executivo", "◫", "Executivo"],
  ["/superadmin/operacoes-internas", "▣", "Operações Internas"],
  ["/superadmin/estabelecimentos", "⌂", "Estabelecimentos"],
  ["/superadmin/clientes", "◎", "Clientes e usuários"],
  ["/superadmin/onboarding", "✓", "Onboarding"],
  ["/superadmin/assinaturas", "◇", "Assinaturas"],
  ["/superadmin/billing", "▥", "Billing SaaS"],
  ["/superadmin/planos", "▤", "Planos"],
  ["/superadmin/apps", "⌘", "Apps para revisão"],
  ["/superadmin/pagamentos", "$", "Pagamentos"],
  ["/superadmin/cupons", "%", "Cupons"],
  ["/superadmin/suporte", "?", "Suporte"],
  ["/superadmin/avisos", "!", "Avisos"],
  ["/superadmin/logs", "≡", "Auditoria"],
  ["/superadmin/seguranca", "◈", "Segurança"],
  ["/superadmin/performance", "⌁", "Performance"],
  ["/superadmin/qualidade", "✓", "Qualidade"],
  ["/superadmin/busca", "⌕", "Saúde da busca"],
  ["/superadmin/produto", "◉", "Produto"],
  ["/superadmin/growth", "↗", "Growth / Clientes"],
  ["/superadmin/customer-success", "♥", "Customer Success"],
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
      <footer><div className="sa-user"><span>{name.slice(0, 2).toUpperCase()}</span><div><b>{name || "Super Admin"}</b><small>Acesso global protegido</small></div></div><Link href="/painel">Abrir painel comum</Link><Link href="/">Sair da área</Link></footer>
    </aside>
    <section className="sa-main"><header className="sa-topbar"><div><b>Central da plataforma</b><small>Dados reais em tempo real</small></div><Link href="/superadmin/configuracoes">Configurações globais</Link></header><div className="sa-content">{children}</div></section>
  </main>;
}
