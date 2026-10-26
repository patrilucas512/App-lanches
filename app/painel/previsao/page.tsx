import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { ForecastCenter } from "@/components/forecast-center";
import { getDashboardContext } from "@/lib/dashboard";

export default async function ForecastPage() {
  const { establishment, member } = await getDashboardContext();
  if (["attendant", "kitchen", "catalog_editor"].includes(member.role)) redirect("/painel");
  return <DashboardShell brand={establishment} active="forecast" storeSlug={establishment.slug} role={member.role}>
    <header className="admin-page-heading forecast-heading"><div><small>INTELIGÊNCIA → PREVISÃO</small><h1>Planeje demanda, estoque e capacidade.</h1><p>Baseline estatístico, backtest, intervalo de confiança e recomendação com controle humano.</p></div><span className="manager-safety-pill">Nenhuma ação automática</span></header>
    <ForecastCenter storeId={establishment.id} storeName={establishment.name} />
  </DashboardShell>;
}
