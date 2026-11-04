import { DashboardShell } from "@/components/dashboard-shell";
import { ModuleUnavailable } from "@/components/module-unavailable";
import { getDashboardContext } from "@/lib/dashboard";
import { MODULE_RULES, moduleOffReason, type MenuPlan } from "@/lib/menu-entitlements";

// Fase 98C: destino das telas que antes voltavam para /painel sem explicar quando o módulo estava desligado.
export default async function ModuleUnavailablePage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { establishment, member } = await getDashboardContext();
  const requested = (await searchParams).m ?? "";
  const moduleKey = Object.prototype.hasOwnProperty.call(MODULE_RULES, requested) ? requested : "";
  const plan = (establishment.plan ?? {}) as MenuPlan;
  const reason = moduleKey ? moduleOffReason(moduleKey, plan, establishment.basePlan as MenuPlan | null) : "plan";
  return <DashboardShell brand={establishment} active="module-unavailable" storeSlug={establishment.slug} role={member.role}>
    <ModuleUnavailable moduleKey={moduleKey || "unknown"} reason={reason} role={member.role} />
  </DashboardShell>;
}
