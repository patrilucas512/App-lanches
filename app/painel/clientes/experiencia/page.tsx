import {redirect} from "next/navigation";
import {DashboardShell} from "@/components/dashboard-shell";
import {CustomerExperienceCenter} from "@/components/customer-experience-center";
import {getDashboardContext} from "@/lib/dashboard";
import "../../seguranca/soc/soc.css";
export const dynamic="force-dynamic";
export default async function CustomerExperiencePage(){const{establishment,member,organizationMember}=await getDashboardContext();if(!["owner","manager"].includes(member.role)&&!["owner","admin","supervisor","analyst"].includes(organizationMember?.role||""))redirect("/painel");return <DashboardShell brand={establishment} active="customer-experience" storeSlug={establishment.slug} role={member.role}><header className="dashboard-head soc-head"><div><small>CLIENTES · EXPERIÊNCIA</small><h1>Experiência & Reputação</h1><p>O que os clientes dizem, o que falta responder e o que precisa de cuidado agora.</p></div></header><CustomerExperienceCenter storeId={establishment.id} storeSlug={establishment.slug}/></DashboardShell>}
