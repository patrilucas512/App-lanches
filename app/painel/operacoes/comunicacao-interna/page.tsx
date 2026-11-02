import {redirect} from "next/navigation";
import {DashboardShell} from "@/components/dashboard-shell";
import {InternalCommunicationsCenter} from "@/components/internal-communications-center";
import {getDashboardContext} from "@/lib/dashboard";
import "../../seguranca/soc/soc.css";
export const dynamic="force-dynamic";
export default async function InternalCommunicationsPage(){const{establishment,member,organizationMember}=await getDashboardContext();if(!["owner","manager"].includes(member.role)&&!["owner","admin","supervisor","analyst"].includes(organizationMember?.role||""))redirect("/painel/comunicados");return <DashboardShell brand={establishment} active="internal-communications" storeSlug={establishment.slug} role={member.role}><header className="dashboard-head soc-head"><div><small>OPERAÇÕES · COMUNICAÇÃO INTERNA</small><h1>Comunicação Interna</h1><p>O que foi avisado, quem precisa confirmar e o que espera aprovação.</p></div></header><InternalCommunicationsCenter storeId={establishment.id}/></DashboardShell>}
