import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { MarketingIntelligenceCenter } from "@/components/marketing-intelligence-center";
import { getDashboardContext } from "@/lib/dashboard";
export default async function MarketingIntelligencePage(){const{establishment,member}=await getDashboardContext();if(["attendant","kitchen","catalog_editor"].includes(member.role))redirect("/painel");return <DashboardShell brand={establishment} active="marketing-intelligence" storeSlug={establishment.slug} role={member.role}><header className="admin-page-heading"><div><small>MARKETING ORIENTADO POR DADOS</small><h1>Inteligência de Marketing</h1><p>Públicos, promoções, experimentos, margem e atribuição em um único fluxo auditável.</p></div><span className="manager-safety-pill">Sem disparo automático</span></header><MarketingIntelligenceCenter storeName={establishment.name}/></DashboardShell>}
