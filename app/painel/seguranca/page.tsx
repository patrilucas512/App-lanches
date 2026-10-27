import { DashboardShell } from "@/components/dashboard-shell";
import { SecurityCenter } from "@/components/security-center";
import { getDashboardContext } from "@/lib/dashboard";

export const dynamic="force-dynamic";

export default async function SecurityPage(){
 const{establishment,member,organization,organizationMember,plan}=await getDashboardContext();
 const organizationId=organization?.id||establishment.organization_id;
 const isAdmin=["owner","admin"].includes(organizationMember?.role||"")||["owner","manager"].includes(member.role);
 return <DashboardShell brand={establishment} active="security" storeSlug={establishment.slug} role={member.role}><header className="dashboard-head"><div><small>SEGURANÇA ENTERPRISE</small><h1>Segurança e continuidade.</h1><p>Proteja acessos, acompanhe sessões, configure políticas e monitore a recuperação da operação.</p></div></header><SecurityCenter organizationId={organizationId} isAdmin={isAdmin} entitlements={(plan||{}) as Record<string,unknown>}/></DashboardShell>;
}
