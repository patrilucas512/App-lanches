import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { getDashboardContext } from "@/lib/dashboard";
import { InventoryPhase16Console } from "@/components/inventory-phase16-console";

export default async function InventoryPage() {
  const { establishment, member } = await getDashboardContext();
  if (!["owner","manager"].includes(member.role)) redirect("/painel");
  return <DashboardShell brand={establishment} active="inventory" storeSlug={establishment.slug} role={member.role}>
    <header className="dashboard-head"><div><small>PRODUTOS E INSUMOS</small><h1>Estoque</h1><p>Saldo, reposição e consumo por produto, sem repetir a baixa no caixa.</p></div></header>
    <InventoryPhase16Console establishmentId={establishment.id} organizationId={establishment.organization_id || establishment.id} />
  </DashboardShell>;
}
