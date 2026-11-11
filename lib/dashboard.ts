import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { mergeStoreFlags } from "@/lib/store-entitlements";
import { isBillingBlocked } from "@/lib/plan-reading";

export async function getDashboardContext(options: { allowBlocked?: boolean } = {}) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");
  const { data: memberships } = await supabase.from("establishment_members").select("establishment_id, role").eq("user_id", userId).eq("status", "active").order("created_at");
  if (!memberships?.length) redirect("/onboarding");
  const preferredStoreId = (await cookies()).get("masterapp_active_store")?.value;
  const member = memberships.find((item: { establishment_id: string }) => item.establishment_id === preferredStoreId) ?? memberships[0];
  const { data: establishment } = await supabase.from("establishments").select("id, organization_id, name, slug, unit_status, timezone, onboarding_completed, logo_url, menu_display_name, menu_logo_url, accent_color, menu_background_color, menu_surface_color, menu_text_color, menu_muted_color, subscriptions(status,trial_ends_at,plans(*))").eq("id", member.establishment_id).single();
  if (!establishment) redirect("/onboarding");
  const { data: organizationMember } = await supabase.from("organization_members").select("role,all_stores,active").eq("organization_id", establishment.organization_id).eq("user_id", userId).eq("active", true).maybeSingle();
  let storeQuery = supabase.from("establishments").select("id,name,slug,unit_status,capacity_level").eq("organization_id", establishment.organization_id).order("name");
  if (!organizationMember?.all_stores) storeQuery = storeQuery.in("id", memberships.map((item: { establishment_id: string }) => item.establishment_id));
  const { data: availableStores } = await storeQuery;
  // `subscriptions` (establishment_id único) e `plans` (muitos-para-um) chegam do PostgREST como objeto, não
  // lista. Ler `subscriptions[0].plans[0]` deixava o plano sempre nulo: o menu e as telas ignoravam o plano
  // (achado na Fase 98C pelo E2E). Aceita os dois formatos.
  const rawSubscription = establishment.subscriptions as unknown;
  const subscription = (Array.isArray(rawSubscription) ? rawSubscription[0] : rawSubscription) as { plans?: unknown; status?: string | null; trial_ends_at?: string | null } | null | undefined;
  const rawPlan = subscription?.plans;
  // Tipo aberto como antes: as telas leem as colunas do plano direto (establishment.plan?.x_enabled).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const basePlan = ((Array.isArray(rawPlan) ? rawPlan[0] : rawPlan) ?? null) as any;
  const billingBlocked = isBillingBlocked(subscription, basePlan);
  if (billingBlocked && !options.allowBlocked) redirect("/painel/escolher-plano");
  const { data: networkPlan } = basePlan?.id
    ? await supabase.from("plans").select("network_governance_enabled,franchise_management_enabled,central_catalog_enabled,network_pricing_enabled,network_benchmarking_enabled,food_quality_enabled,lot_tracking_enabled,temperature_tracking_enabled,traceability_enabled,internal_recall_enabled").eq("id", basePlan.id).maybeSingle()
    : { data: null };
  const { data: storeFlags } = basePlan ? await supabase.from("store_feature_flags").select("*").eq("establishment_id", establishment.id).maybeSingle() : { data: null };
  const unmergedPlan = basePlan ? { ...basePlan, ...(networkPlan ?? {}) } : null;
  const plan = unmergedPlan ? mergeStoreFlags(unmergedPlan, storeFlags) : null;
  const { data: organization } = await supabase.from("organizations").select("id,name,loyalty_mode,status").eq("id", establishment.organization_id).maybeSingle();
  return { supabase, userId, member, plan, billingBlocked, subscription: subscription ? { status: subscription.status ?? null, trial_ends_at: subscription.trial_ends_at ?? null } : null, organization, organizationMember, availableStores: availableStores ?? [], establishment: { ...establishment, plan, basePlan: unmergedPlan, organization, availableStores: availableStores ?? [] } };
}
