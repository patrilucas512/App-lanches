import {redirect} from "next/navigation";
import {DashboardShell} from "@/components/dashboard-shell";
import {PrivacyOperationsCenter} from "@/components/privacy-operations-center";
import {getDashboardContext} from "@/lib/dashboard";
import "../soc/soc.css";
export const dynamic="force-dynamic";
export default async function PrivacyOperationsPage(){const{establishment,member,organizationMember}=await getDashboardContext();if(!["owner","manager"].includes(member.role)&&!["owner","admin","supervisor","analyst"].includes(organizationMember?.role||""))redirect("/painel");return <DashboardShell brand={establishment} active="privacy-operations" storeSlug={establishment.slug} role={member.role}><header className="dashboard-head soc-head"><div><small>SEGURANÇA · PRIVACIDADE & LGPD</small><h1>Privacidade & LGPD</h1><p>Onde estão os dados pessoais, com que base são tratados, o que os titulares pediram e o que vence.</p></div></header><PrivacyOperationsCenter storeId={establishment.id}/></DashboardShell>}
