import { DashboardShell } from "@/components/dashboard-shell";
import { SettingsForm } from "@/components/settings-form";
import { getDashboardContext } from "@/lib/dashboard";

export default async function SettingsPage() {
  const { supabase, establishment } = await getDashboardContext();
  const [{ data: details }, { data: settings }] = await Promise.all([
    supabase.from("establishments").select("*").eq("id", establishment.id).single(),
    supabase.from("establishment_settings").select("*").eq("establishment_id", establishment.id).single(),
  ]);
  return <DashboardShell active="settings" storeSlug={establishment.slug}>
    <header className="dashboard-head"><div><small>CONFIGURAÇÕES</small><h1>Identidade e atendimento.</h1></div></header>
    <SettingsForm establishmentId={establishment.id} initial={{
      name: details?.name ?? establishment.name, description: details?.description ?? "",
      phone: details?.phone ?? "", whatsapp: settings?.whatsapp ?? "",
      address: String(settings?.address?.street ?? ""), city: details?.city ?? "",
      state: details?.state ?? "", accentColor: details?.accent_color ?? "#6d2627",
      secondaryColor: details?.secondary_color ?? "#f5efe5",
      estimatedMinutes: settings?.estimated_minutes ?? 45,
      minimumOrderCents: settings?.minimum_order_cents ?? 0,
    }} />
  </DashboardShell>;
}
