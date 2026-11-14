import { AnalyticsCenter } from "@/components/analytics-center";
import { requireSuperadmin } from "@/lib/superadmin";

export const dynamic = "force-dynamic";
export default async function SuperadminAnalyticsPage() {
  await requireSuperadmin();
  return <><header className="sa-page-head"><div><small>PLATAFORMA DE DADOS · RELATÓRIOS · BASE DE DADOS</small><h1>Análise de dados</h1><p>Dados organizados, com histórico e registro de auditoria, para apoiar as decisões do MasterApp.</p></div></header><AnalyticsCenter internal /></>;
}
