import {redirect} from "next/navigation";
import {DashboardShell} from "@/components/dashboard-shell";
import {IdentityGovernanceCenter} from "@/components/identity-governance-center";
import {getDashboardContext} from "@/lib/dashboard";
import "../soc/soc.css";
export const dynamic="force-dynamic";
export default async function IdentityGovernancePage(){const{establishment,member,organizationMember}=await getDashboardContext();if(!["owner","manager"].includes(member.role)&&!["owner","admin","manager","supervisor","analyst"].includes(organizationMember?.role||""))redirect("/painel");return <DashboardShell brand={establishment} active="identity-governance" storeSlug={establishment.slug} role={member.role}><header className="dashboard-head soc-head"><div><small>SEGURANÇA · ACESSOS</small><h1>Governança de Acessos</h1><p>Quem tem acesso a quê, por quê, aprovado por quem e até quando.</p></div></header><IdentityGovernanceCenter storeId={establishment.id}/></DashboardShell>}
