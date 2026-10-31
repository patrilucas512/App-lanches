import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { DataGovernanceCenter } from "@/components/data-governance-center";
import { getDashboardContext } from "@/lib/dashboard";
import "./data-governance.css";
export default async function DataGovernancePage(){const{establishment,member,organizationMember}=await getDashboardContext();if((establishment.plan as{data_catalog_enabled?:boolean}|null)?.data_catalog_enabled===false)redirect("/painel");if(!["owner","manager"].includes(member.role)&&!["owner","admin","manager","supervisor"].includes(organizationMember?.role||""))redirect("/painel");return <DashboardShell brand={establishment} active="data-governance" storeSlug={establishment.slug} role={member.role}><header className="dashboard-head dg-head"><div><small>DADOS · CONFIANÇA · RESPONSABILIDADE</small><h1>Governança de Dados</h1><p>Catálogo empresarial, contratos, linhagem e observabilidade sobre o Data Platform existente.</p></div><div className="dg-head-state"><i/>Plataforma governada<small>Alterações críticas exigem revisão</small></div></header><DataGovernanceCenter storeId={establishment.id}/></DashboardShell>}
