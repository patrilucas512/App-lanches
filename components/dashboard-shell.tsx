import Link from "next/link";
import { Brand } from "@/components/ui";

export function DashboardShell({ children, active = "overview", storeSlug }: { children: React.ReactNode; active?: string; storeSlug?: string }) {
  const links = [
    ["overview", "/painel", "Visão geral"],
    ["orders", "/painel/pedidos", "Pedidos"],
    ["catalog", "/painel/cardapio", "Cardápio"],
    ["team", "/painel/equipe", "Equipe"],
    ["billing", "/painel/assinatura", "Plano e cobrança"],
  ];
  return <main className="dashboard"><aside className="sidebar"><Brand /><nav>{links.map(([key, href, label]) => <Link key={key} className={active === key ? "active" : ""} href={href}>{label}</Link>)}{storeSlug && <Link href={`/loja/${storeSlug}`} target="_blank">Ver minha loja ↗</Link>}</nav><div className="sidebar-bottom"><Link href="/">Sair do painel</Link></div></aside><section className="dashboard-main">{children}</section></main>;
}
