import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { ManagerCopilot } from "@/components/manager-copilot";
import { getDashboardContext } from "@/lib/dashboard";
import { resolveManagerPeriod } from "@/lib/intelligence/periods";
import type { ManagerPeriodKey, ManagerSnapshot } from "@/lib/intelligence/types";

const allowedPeriods = new Set<ManagerPeriodKey>(["today", "yesterday", "7d", "30d", "month", "previous_month", "custom"]);

export default async function IntelligencePage({ searchParams }: { searchParams: Promise<{ period?: string; start?: string; end?: string; all?: string; tab?: string }> }) {
  const { supabase, establishment, member } = await getDashboardContext();
  if (["attendant", "kitchen", "catalog_editor"].includes(member.role)) redirect("/painel");
  const params = await searchParams; const requested = (params.period || "today") as ManagerPeriodKey;
  const key = allowedPeriods.has(requested) && (requested !== "custom" || (params.start && params.end)) ? requested : "today";
  const period = resolveManagerPeriod(key, establishment.timezone || "America/Sao_Paulo", new Date(), params.start, params.end);
  const { data, error } = await supabase.rpc("get_manager_copilot_snapshot", {
    requested_establishment_id: establishment.id, requested_start: period.start, requested_end: period.end,
    requested_compare_start: period.compareStart, requested_compare_end: period.compareEnd, requested_all_units: params.all === "1",
  });
  if (error || !data) redirect("/painel");
  return <DashboardShell brand={establishment} active="intelligence" storeSlug={establishment.slug} role={member.role}>
    <header className="admin-page-heading manager-page-head"><div><small>INTELIGÊNCIA OPERACIONAL · FASE 10</small><h1>Copiloto do Gestor.</h1><p>Analise a operação e execute ajustes permitidos com prévia, confirmação humana, revalidação e auditoria.</p></div><span className="manager-safety-pill">Ações controladas</span></header>
    <ManagerCopilot establishmentId={establishment.id} establishmentName={establishment.name} initialSnapshot={data as ManagerSnapshot} period={period} initialTab={params.tab} allUnits={Boolean((data as ManagerSnapshot).scope?.all_units)} customStart={params.start} customEnd={params.end} />
  </DashboardShell>;
}
