// Fase 98C: trava de módulo para as rotas de API, com a mesma regra do menu (lib/menu-entitlements.ts).
// Resposta padrão quando o módulo está desligado: HTTP 403 com {"error":"FEATURE_DISABLED"} (o formato que as
// rotas das Fases 38, 57, 93 e 95 já usavam), mais o módulo e uma mensagem legível.
import { createAdminClient } from "@/lib/supabase/admin";
import { isMenuItemEntitled, MODULE_RULES } from "@/lib/menu-entitlements";
import { mergeStoreFlags } from "@/lib/store-entitlements";

export const FEATURE_DISABLED = "FEATURE_DISABLED";

export function moduleUnavailableBody(moduleKey: string) {
  const label = MODULE_RULES[moduleKey]?.label ?? "Este módulo";
  return { error: FEATURE_DISABLED, module: moduleKey, message: `${label} não está disponível no plano desta loja.` };
}

export async function storeModuleEnabled(storeId: string, moduleKey: string): Promise<boolean> {
  if (!MODULE_RULES[moduleKey]) return true;
  const admin = createAdminClient();
  const [{ data: subscription }, { data: storeFlags }] = await Promise.all([
    admin.from("subscriptions").select("plans(*)").eq("establishment_id", storeId)
      .in("status", ["active", "trialing", "past_due"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("store_feature_flags").select("*").eq("establishment_id", storeId).maybeSingle(),
  ]);
  const raw = (subscription as { plans?: unknown } | null)?.plans;
  const plan = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | undefined;
  // Sem assinatura vigente, nenhum módulo com regra fica disponível.
  if (!plan) return false;
  return isMenuItemEntitled(moduleKey, mergeStoreFlags(plan, storeFlags as Record<string, unknown> | null));
}

// Para as rotas que tratam erros pela mensagem: lança Error("FEATURE_DISABLED").
export async function requireModuleEnabled(storeId: string, moduleKey: string) {
  if (!(await storeModuleEnabled(storeId, moduleKey))) throw new Error(FEATURE_DISABLED);
}
