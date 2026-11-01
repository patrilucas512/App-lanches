import {redirect} from "next/navigation";
import {DashboardShell} from "@/components/dashboard-shell";
import {BusinessContinuityCenter} from "@/components/business-continuity-center";
import {getDashboardContext} from "@/lib/dashboard";
import "./continuity.css";
export const dynamic="force-dynamic";
export default async function BusinessContinuityPage(){const{establishment,member,organizationMember}=await getDashboardContext();if((establishment.plan as{business_continuity_enabled?:boolean}|null)?.business_continuity_enabled===false)redirect("/painel");if(!["owner","manager"].includes(member.role)&&!["owner","admin","manager","supervisor","analyst"].includes(organizationMember?.role||""))redirect("/painel");return <DashboardShell brand={establishment} active="business-continuity" storeSlug={establishment.slug} role={member.role}><header className="dashboard-head bc-head"><div><small>OPERAÇÕES · RESILIÊNCIA ORGANIZACIONAL</small><h1>Continuidade de Negócios</h1><p>BIA, MTD, RTO, RPO, planos versionados, restore validado e recuperação orquestrada com aprovação humana.</p><p><a href="/painel/operacoes/confiabilidade">Confiabilidade histórica</a> · <a href="/painel/operacoes/central-da-rede">Saúde atual da rede</a> · <a href="/painel/incidentes">Incidentes</a></p></div></header><BusinessContinuityCenter storeId={establishment.id}/></DashboardShell>}
