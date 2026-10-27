import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { CustomerJourneysCenter } from "@/components/customer-journeys-center";
import { getDashboardContext } from "@/lib/dashboard";
import "./journeys.css";
export default async function JourneysPage(){const{establishment,member,organizationMember}=await getDashboardContext();if(establishment.plan?.customer_journeys_enabled===false)redirect("/painel");if(!["owner","manager","attendant"].includes(member.role)&&!["owner","admin","supervisor"].includes(organizationMember?.role||""))redirect("/painel");return <DashboardShell brand={establishment} active="journeys" storeSlug={establishment.slug} role={member.role}><header className="dashboard-head journey-head"><div><small>FASE 61 · CUSTOMER JOURNEY</small><h1>Jornadas de relacionamento</h1><p>Ative, retenha e recupere clientes com consentimento, contexto e controle operacional.</p></div><span>Motor: Automação Fase 50</span></header><CustomerJourneysCenter storeId={establishment.id}/></DashboardShell>}
