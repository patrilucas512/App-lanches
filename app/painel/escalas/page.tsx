import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { WorkforcePlanningCenter } from "@/components/workforce-planning-center";
import { getDashboardContext } from "@/lib/dashboard";
import "./workforce-planning.css";

export default async function WorkforcePlanningPage(){
 const {establishment,member,organizationMember}=await getDashboardContext();
 if(establishment.plan?.advanced_workforce_planning_enabled===false)redirect("/painel/equipe/gestao");
 if(!["owner","manager"].includes(member.role)&&!["owner","admin","supervisor"].includes(organizationMember?.role||""))redirect("/painel/equipe/gestao");
 return <DashboardShell brand={establishment} active="workforce-planning" storeSlug={establishment.slug} role={member.role}>
  <header className="dashboard-head wfp-page-head"><div><small>FASE 58 · PLANEJAMENTO AVANÇADO</small><h1>Escalas e Cobertura</h1><p>Previsão de demanda, skills, horários de pico e custo gerencial em um planejamento auditável.</p></div><a href="/equipe/escala">Abrir Minha Escala ↗</a></header>
  <WorkforcePlanningCenter storeId={establishment.id}/>
 </DashboardShell>;
}
