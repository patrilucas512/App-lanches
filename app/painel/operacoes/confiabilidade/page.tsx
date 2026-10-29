import {redirect} from "next/navigation";
import {DashboardShell} from "@/components/dashboard-shell";
import {ServiceReliabilityCenter} from "@/components/service-reliability-center";
import {getDashboardContext} from "@/lib/dashboard";
import "./reliability.css";
export const dynamic="force-dynamic";
export default async function ReliabilityPage(){const{establishment,member,organizationMember}=await getDashboardContext();if((establishment.plan as{service_reliability_enabled?:boolean}|null)?.service_reliability_enabled===false)redirect("/painel");if(!["owner","manager"].includes(member.role)&&!["owner","admin","manager","supervisor","analyst"].includes(organizationMember?.role||""))redirect("/painel");return <DashboardShell brand={establishment} active="service-reliability" storeSlug={establishment.slug} role={member.role}><header className="dashboard-head rel-head"><div><small>OPERAÇÕES · RELIABILITY ENGINEERING</small><h1>Confiabilidade de Serviços</h1><p>Service Catalog, jornadas críticas, SLIs, SLOs, error budgets e guardrails de release — com telemetria oficial, janelas explícitas e decisões auditáveis.</p><p><a href="/painel/operacoes/continuidade-negocio">Abrir Continuidade de Negócios: BIA, MTD, RTO, RPO e recuperação</a></p></div></header><ServiceReliabilityCenter storeId={establishment.id}/></DashboardShell>}
