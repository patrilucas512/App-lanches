import{redirect}from"next/navigation";
import{DashboardShell}from"@/components/dashboard-shell";
import{CapacityManagementCenter}from"@/components/capacity-management-center";
import{getDashboardContext}from"@/lib/dashboard";
import"./capacity.css";
export default async function CapacityPage(){const{establishment,member,organizationMember}=await getDashboardContext();if((establishment.plan as{capacity_management_enabled?:boolean}|null)?.capacity_management_enabled===false)redirect("/painel");if(!["owner","manager"].includes(member.role)&&!["owner","admin","manager","supervisor"].includes(organizationMember?.role||""))redirect("/painel");return <DashboardShell brand={establishment} active="capacity" storeSlug={establishment.slug} role={member.role}><header className="dashboard-head capacity-head"><div><small>FASE 63 · ORQUESTRAÇÃO OPERACIONAL</small><h1>Capacidade</h1><p>Filas, slots, promessas e proteção da operação em tempo real.</p></div><span>Engine secundário · fallback seguro</span></header><CapacityManagementCenter storeId={establishment.id}/></DashboardShell>}
