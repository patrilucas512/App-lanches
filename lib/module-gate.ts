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

// Fase 99A: módulos que trabalham por organização (canais de delivery): basta uma loja ativa da organização ter
// o módulo.
export async function requireOrganizationModuleEnabled(organizationId: string, moduleKey: string) {
  const { data: stores } = await createAdminClient().from("establishments").select("id").eq("organization_id", organizationId).eq("active", true).limit(50);
  for (const store of (stores ?? []) as { id: string }[]) if (await storeModuleEnabled(store.id, moduleKey)) return;
  throw new Error(FEATURE_DISABLED);
}

// Fase 99A: rotas públicas por slug da loja (portal do cliente).
export async function storeModuleEnabledBySlug(slug: string, moduleKey: string): Promise<boolean> {
  const { data: store } = await createAdminClient().from("establishments").select("id").eq("slug", slug).maybeSingle();
  return Boolean(store) && (await storeModuleEnabled((store as { id: string }).id, moduleKey));
}
