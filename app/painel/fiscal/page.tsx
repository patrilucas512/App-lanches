import {redirect} from "next/navigation";
import {DashboardShell} from "@/components/dashboard-shell";
import {FiscalPhase19Console} from "@/components/fiscal-phase19-console";
import {getDashboardContext} from "@/lib/dashboard";
export default async function FiscalPage(){
 const {establishment,member,plan}=await getDashboardContext();
 if(!["owner","manager"].includes(member.role))redirect("/painel");
 if(plan?.fiscal_module_enabled===false)redirect("/painel");
 return <DashboardShell brand={establishment} active="fiscal" storeSlug={establishment.slug} role={member.role}>
  <header className="dashboard-head"><div><small>DOCUMENTOS E INTEGRAÇÕES</small><h1>Fiscal</h1><p>Emissão, recebimento, arquivo digital e exportação contábil com rastreabilidade.</p></div></header>
  <FiscalPhase19Console establishmentId={establishment.id} organizationId={establishment.organization_id||establishment.id}/>
 </DashboardShell>;
}
