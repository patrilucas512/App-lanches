import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { MasterDataCenter } from "@/components/master-data-center";
import { getDashboardContext } from "@/lib/dashboard";
import "./master-data.css";
export default async function MasterDataPage(){const{establishment,member,organizationMember}=await getDashboardContext();if((establishment.plan as{mdm_enabled?:boolean}|null)?.mdm_enabled===false)redirect("/painel");if(!["owner","manager"].includes(member.role)&&!["owner","admin","manager","supervisor"].includes(organizationMember?.role||""))redirect("/painel");return <DashboardShell brand={establishment} active="master-data" storeSlug={establishment.slug} role={member.role}><header className="dashboard-head mdm-head"><div><small>GOVERNANÇA · IDENTIDADE · QUALIDADE</small><h1>Dados Mestres</h1><p>Golden records, identificadores, duplicidades e linhagem com os domínios oficiais preservados.</p></div><div className="mdm-head-state"><i/>Governança ativa<small>Sem auto-merge crítico</small></div></header><MasterDataCenter storeId={establishment.id}/></DashboardShell>}
