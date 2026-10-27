import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { FinancialPhase17Console } from "@/components/financial-phase17-console";
import { getDashboardContext } from "@/lib/dashboard";

export default async function FinancialPage(){
 const {establishment,member,organizationMember}=await getDashboardContext();
 if(!["owner","manager"].includes(member.role))redirect("/painel");
 const allowConsolidated=organizationMember?.all_stores===true&&["owner","admin","supervisor"].includes(String(organizationMember.role));
 return <DashboardShell brand={establishment} active="finance" storeSlug={establishment.slug} role={member.role}>
  <header className="dashboard-head"><div><small>GESTÃO E AUDITORIA</small><h1>Financeiro</h1><p>Caixa, contas, conciliação, custos e resultado gerencial ligados às fontes oficiais do MasterApp.</p></div></header>
  <FinancialPhase17Console establishmentId={establishment.id} organizationId={establishment.organization_id||establishment.id} allowConsolidated={allowConsolidated}/>
 </DashboardShell>;
}
