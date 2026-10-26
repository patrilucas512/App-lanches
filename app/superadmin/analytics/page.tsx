import { AnalyticsCenter } from "@/components/analytics-center";
import { requireSuperadmin } from "@/lib/superadmin";

export const dynamic = "force-dynamic";
export default async function SuperadminAnalyticsPage() {
  await requireSuperadmin();
  return <><header className="sa-page-head"><div><small>DATA PLATFORM · BI · WAREHOUSE</small><h1>Analytics & Dados</h1><p>Camada analítica governada, histórica e auditável para decisões do MasterApp.</p></div></header><AnalyticsCenter internal /></>;
}
