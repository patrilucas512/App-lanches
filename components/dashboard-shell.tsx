import Link from "next/link";
import { Brand } from "@/components/ui";
import { DashboardMobileNav } from "@/components/dashboard-mobile-nav";

export function DashboardShell({ children, active = "overview", storeSlug, role }: { children: React.ReactNode; active?: string; storeSlug?: string; role?: string }) {
  const allLinks = [
    ["overview", "/painel", "Visão geral"],
    ["attendance", "/painel/atendimento", "Atendimento"],
    ["kitchen", "/cozinha", "Cozinha"],
    ["orders", "/painel/pedidos", "Pedidos"],
    ["catalog", "/painel/cardapio", "Cardápio"],
    ["calls", "/painel/chamados", "Chamados"],
    ["team", "/painel/equipe", "Equipe"],
    ["settings", "/painel/configuracoes", "Configurações"],
    ["billing", "/painel/assinatura", "Plano e cobrança"],
  ];
  const attendantLinks = [
    ["waiter", "/painel/garcom", "Pedidos"],
    ["calls", "/painel/chamados", "Chamados"],
  ];
  const links = role === "attendant" ? attendantLinks
    : role === "kitchen" ? allLinks.filter(([key]) => key === "kitchen")
    : role === "catalog_editor" ? allLinks.filter(([key]) => key === "catalog") : allLinks;
  const mobileLinks = links.map(([key, href, label]) => ({ key, href, label }));
  return <main className="dashboard"><aside className="sidebar"><Brand /><nav>{links.map(([key, href, label]) => <Link key={key} className={active === key ? "active" : ""} href={href}>{label}</Link>)}{storeSlug && <Link href={`/loja/${storeSlug}`} target="_blank">Ver minha loja ↗</Link>}</nav><div className="sidebar-bottom"><Link href="/">Sair do painel</Link></div></aside><section className="dashboard-main"><DashboardMobileNav links={mobileLinks} active={active} storeSlug={storeSlug} />{children}</section></main>;
}
