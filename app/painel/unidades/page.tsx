import { DashboardShell } from "@/components/dashboard-shell";
import { UnitManagement } from "@/components/unit-management";
import { getDashboardContext } from "@/lib/dashboard";

export default async function UnitsPage() {
  const { supabase, establishment, organization, plan, member } = await getDashboardContext();
  const { data } = await supabase.rpc("get_organization_unit_dashboard", { requested_organization_id: establishment.organization_id });
  const dashboard = data ?? { units: [], totals: {} };
  return <DashboardShell brand={establishment} active="units" storeSlug={establishment.slug} role={member.role}>
    <header className="admin-page-heading"><div><small>OPERAÇÃO · UNIDADES</small><h1>{organization?.name ?? establishment.name}</h1><p>Visão consolidada da rede com isolamento operacional entre lojas.</p></div></header>
    <UnitManagement organizationId={establishment.organization_id} units={dashboard.units ?? []} totals={dashboard.totals ?? {}} maxStores={plan?.max_establishments ?? null} />
  </DashboardShell>;
}
