import{redirect}from"next/navigation";
import{DashboardShell}from"@/components/dashboard-shell";
import{ChangeManagementCenter}from"@/components/change-management-center";
import{getDashboardContext}from"@/lib/dashboard";
import"./change-management.css";
export const dynamic="force-dynamic";
export default async function ChangeManagementPage(){const{establishment,member,organizationMember}=await getDashboardContext();if((establishment.plan as{enterprise_change_management_enabled?:boolean}|null)?.enterprise_change_management_enabled===false)redirect("/painel");if(!["owner","manager"].includes(member.role)&&!["owner","admin","manager","supervisor","analyst"].includes(organizationMember?.role||""))redirect("/painel");return <DashboardShell brand={establishment} active="change-management" storeSlug={establishment.slug} role={member.role}><header className="dashboard-head cm-head"><div><small>GOVERNANÇA · ENTERPRISE CHANGE MANAGEMENT</small><h1>Mudanças</h1><p>Registro, risco, calendário, conflitos, approvals, rollback e validação pós-mudança — sem duplicar os executores oficiais.</p><p><a href="/painel/operacoes/confiabilidade">Confiabilidade</a> · <a href="/painel/incidentes">Incidentes</a> · <a href="/painel/governanca/riscos">Riscos</a></p></div></header><ChangeManagementCenter storeId={establishment.id}/></DashboardShell>}
