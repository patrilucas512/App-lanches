import{redirect}from"next/navigation";
import{DashboardShell}from"@/components/dashboard-shell";
import{CentralProductionCenter}from"@/components/central-production-center";
import{getDashboardContext}from"@/lib/dashboard";
import"./central-production.css";
export default async function CentralProductionPage(){const{establishment,member,organizationMember}=await getDashboardContext();if((establishment.plan as{central_production_enabled?:boolean}|null)?.central_production_enabled===false)redirect("/painel");if(!["owner","manager"].includes(member.role)&&!["owner","admin","manager","supervisor"].includes(organizationMember?.role||""))redirect("/painel");return <DashboardShell brand={establishment} active="central-production" storeSlug={establishment.slug} role={member.role}><header className="dashboard-head cp-page-head"><div><small>REDE · PRODUÇÃO E ABASTECIMENTO</small><h1>Produção Central</h1><p>Planeje, produza, rastreie e abasteça suas unidades com controle de ponta a ponta.</p></div><div className="cp-head-status"><span/><b>Operação integrada</b><small>Estoque · Lotes · Qualidade · Custos</small></div></header><CentralProductionCenter storeId={establishment.id}/></DashboardShell>}

