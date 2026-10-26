import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { SupplyChainCenter } from "@/components/supply-chain-center";
import { getDashboardContext } from "@/lib/dashboard";
import "./supply-chain.css";

export default async function SupplyChainPage(){
  const{establishment,member,organizationMember}=await getDashboardContext();
  if((establishment.plan as{ supply_chain_planning_enabled?:boolean }|null)?.supply_chain_planning_enabled===false)redirect("/painel");
  if(!["owner","manager"].includes(member.role)&&!["owner","admin","manager","supervisor"].includes(organizationMember?.role||""))redirect("/painel");
  return <DashboardShell brand={establishment} active="supply-chain" storeSlug={establishment.slug} role={member.role}><header className="dashboard-head sc-page-head"><div><small>REDE · PLANEJAMENTO DE ABASTECIMENTO</small><h1>Supply Chain</h1><p>Antecipe rupturas, reduza excesso e planeje compras, transferências e produção com decisões explicáveis.</p></div><div className="sc-head-status"><span/><b>Planejamento assistido</b><small>Sem execução automática</small></div></header><SupplyChainCenter storeId={establishment.id}/></DashboardShell>;
}
