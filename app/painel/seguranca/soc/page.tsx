import {redirect} from "next/navigation";
import {DashboardShell} from "@/components/dashboard-shell";
import {SecurityOperationsCenter} from "@/components/security-operations-center";
import {getDashboardContext} from "@/lib/dashboard";
import "./soc.css";
export const dynamic="force-dynamic";
export default async function SecurityOperationsPage(){const{establishment,member,organizationMember}=await getDashboardContext();if((establishment.plan as {security_operations_center_enabled?:boolean}|null)?.security_operations_center_enabled===false)redirect("/painel");if(!["owner","manager"].includes(member.role)&&!["owner","admin","manager","supervisor","analyst"].includes(organizationMember?.role||""))redirect("/painel");return <DashboardShell brand={establishment} active="security-operations" storeSlug={establishment.slug} role={member.role}><header className="dashboard-head soc-head"><div><small>SEGURANÇA · OPERAÇÕES</small><h1>Security Operations Center</h1><p>Detecção, correlação, investigação e resposta controlada com evidências explícitas.</p></div></header><SecurityOperationsCenter storeId={establishment.id}/></DashboardShell>}
