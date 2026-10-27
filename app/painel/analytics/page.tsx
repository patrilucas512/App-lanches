import { redirect } from "next/navigation";
import { AnalyticsCenter } from "@/components/analytics-center";
import { DashboardShell } from "@/components/dashboard-shell";
import { getDashboardContext } from "@/lib/dashboard";

export const dynamic = "force-dynamic";
export default async function OrganizationAnalyticsPage() {
  const { establishment, member } = await getDashboardContext();
  if (["attendant", "kitchen", "catalog_editor"].includes(member.role)) redirect("/painel");
  const organizationId = (establishment as any).organization_id || (establishment as any).organization?.id;
  return <DashboardShell brand={establishment} active="analytics" storeSlug={establishment.slug} role={member.role}><header className="admin-page-heading"><div><small>BI DO ESTABELECIMENTO</small><h1>Analytics & Dados</h1><p>Vendas, clientes e operação com histórico consolidado e métricas certificadas.</p></div></header><AnalyticsCenter organizationId={organizationId} /></DashboardShell>;
}
