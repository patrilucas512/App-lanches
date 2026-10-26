import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { MarketplaceIntegrationCenter } from "@/components/marketplace-integration-center";
import { getDashboardContext } from "@/lib/dashboard";
import "./marketplaces.css";

export default async function MarketplaceIntegrationsPage() {
  const { establishment, member, organizationMember, availableStores } = await getDashboardContext();
  if (establishment.plan?.marketplace_integrations_enabled === false) redirect("/painel/integracoes");
  if (!["owner", "manager"].includes(member.role) && !["owner", "admin", "manager", "supervisor"].includes(organizationMember?.role || "")) redirect("/painel");
  return <DashboardShell brand={establishment} active="marketplace-integrations" storeSlug={establishment.slug} role={member.role}>
    <header className="dashboard-head marketplace-head"><div><small>FASE 69 · CANAIS EXTERNOS</small><h1>Central de marketplaces</h1><p>Pedidos, catálogo, preços, disponibilidade, conciliação e saúde dos canais em um único lugar.</p></div><span>APIs oficiais · operação isolada</span></header>
    <MarketplaceIntegrationCenter organizationId={establishment.organization_id} storeId={establishment.id} stores={(availableStores || []).map(store => ({ id: store.id, name: store.name }))}/>
  </DashboardShell>;
}
