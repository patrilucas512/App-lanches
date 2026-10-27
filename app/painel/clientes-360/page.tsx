import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { Customer360Center } from "@/components/customer-360-center";
import { getDashboardContext } from "@/lib/dashboard";
import "./customer-360.css";

export default async function Customer360Page(){
  const{establishment,member,organizationMember}=await getDashboardContext();
  if(establishment.plan?.customer_360_enabled===false)redirect("/painel");
  if(!["owner","manager","attendant"].includes(member.role)&&!["owner","admin","supervisor"].includes(organizationMember?.role||""))redirect("/painel");
  return <DashboardShell brand={establishment} active="customer360" storeSlug={establishment.slug} role={member.role}><header className="dashboard-head"><div><small>FASE 60 · RELACIONAMENTO E CONTEXTO</small><h1>Perfil 360 do Cliente</h1><p>Identidade, histórico, preferências, fidelidade, suporte e privacidade em uma visão explicável.</p></div></header><Customer360Center storeId={establishment.id}/></DashboardShell>
}
