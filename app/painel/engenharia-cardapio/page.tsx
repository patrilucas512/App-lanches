import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { MenuProfitabilityCenter } from "@/components/menu-profitability-center";
import { getDashboardContext } from "@/lib/dashboard";

export default async function MenuEngineeringPage(){
  const {establishment,member}=await getDashboardContext();
  if(["attendant","kitchen","catalog_editor"].includes(member.role))redirect("/painel");
  return <DashboardShell brand={establishment} active="menu-engineering" storeSlug={establishment.slug} role={member.role}>
    <header className="admin-page-heading profit-heading"><div><small>INTELIGÊNCIA → ENGENHARIA DE CARDÁPIO</small><h1>Margem, popularidade e preço com transparência.</h1><p>Custos rastreáveis, recomendações explicáveis e decisões sempre confirmadas pelo gestor.</p></div><span className="manager-safety-pill">Nenhum preço automático</span></header>
    <MenuProfitabilityCenter storeId={establishment.id} storeName={establishment.name}/>
  </DashboardShell>;
}
