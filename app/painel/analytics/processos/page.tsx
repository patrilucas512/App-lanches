import{redirect}from"next/navigation";
import{DashboardShell}from"@/components/dashboard-shell";
import{ProcessIntelligenceCenter}from"@/components/process-intelligence-center";
import{getDashboardContext}from"@/lib/dashboard";
import"./process-intelligence.css";
export const dynamic="force-dynamic";
export default async function ProcessIntelligencePage(){const{establishment,member,organizationMember}=await getDashboardContext();if((establishment.plan as{process_intelligence_enabled?:boolean}|null)?.process_intelligence_enabled===false)redirect("/painel/analytics");if(!["owner","manager"].includes(member.role)&&!["owner","admin","manager","supervisor","analyst"].includes(organizationMember?.role||""))redirect("/painel/analytics");return <DashboardShell brand={establishment} active="process-intelligence" storeSlug={establishment.slug} role={member.role}><header className="dashboard-head pi-head"><div><small>ANALYTICS · PROCESS INTELLIGENCE</small><h1>Processos</h1><p>Descoberta, variantes, tempos, gargalos, retrabalho e conformidade com evidência rastreável.</p></div></header><ProcessIntelligenceCenter storeId={establishment.id}/></DashboardShell>}
