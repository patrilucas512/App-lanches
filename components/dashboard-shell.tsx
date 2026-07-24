import Link from "next/link";
import { Brand } from "@/components/ui";

export function DashboardShell({ children, active = "overview", storeSlug, role }: { children: React.ReactNode; active?: string; storeSlug?: string; role?: string }) {
  const allLinks = [
    ["overview", "/painel", "Visão geral"],
    ["waiter", "/painel/garcom", "Garçom"],
    ["kitchen", "/cozinha", "Cozinha"],
    ["orders", "/painel/pedidos", "Pedidos"],
    ["catalog", "/painel/cardapio", "Cardápio"],
    ["qrcodes", "/painel/qrcodes", "QR Codes"],
    ["calls", "/painel/chamados", "Chamados"],
    ["team", "/painel/equipe", "Equipe"],
    ["settings", "/painel/configuracoes", "Configurações"],
    ["billing", "/painel/assinatura", "Plano e cobrança"],
  ];
  const attendantLinks = new Set(["waiter", "kitchen", "orders", "calls"]);
  const links = role === "attendant" ? allLinks.filter(([key]) => attendantLinks.has(key))
    : role === "catalog_editor" ? allLinks.filter(([key]) => key === "catalog") : allLinks;
  return <main className="dashboard"><aside className="sidebar"><Brand /><nav>{links.map(([key, href, label]) => <Link key={key} className={active === key ? "active" : ""} href={href}>{label}</Link>)}{storeSlug && <Link href={`/loja/${storeSlug}`} target="_blank">Ver minha loja ↗</Link>}</nav><div className="sidebar-bottom"><Link href="/">Sair do painel</Link></div></aside><section className="dashboard-main"><nav className="mobile-dashboard-nav">{links.map(([key, href, label]) => <Link key={key} className={active === key ? "active" : ""} href={href}>{label}</Link>)}{storeSlug && <Link href={`/loja/${storeSlug}`} target="_blank">Loja ↗</Link>}</nav>{children}</section></main>;
}
