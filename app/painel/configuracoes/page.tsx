import { DashboardShell } from "@/components/dashboard-shell";
import { SettingsForm } from "@/components/settings-form";
import { PixSettingsForm } from "@/components/pix-settings-form";
import { getDashboardContext } from "@/lib/dashboard";
import { redirect } from "next/navigation";

export default async function SettingsPage() {
  const { supabase, establishment, member } = await getDashboardContext();
  if (!["owner", "manager"].includes(member.role)) redirect("/painel/garcom");
  const [{ data: details }, { data: settings }, { data: pix }] = await Promise.all([
    supabase.from("establishments").select("*").eq("id", establishment.id).single(),
    supabase.from("establishment_settings").select("*").eq("establishment_id", establishment.id).single(),
    supabase.from("pix_settings").select("*").eq("establishment_id", establishment.id).maybeSingle(),
  ]);
  return <DashboardShell active="settings" storeSlug={establishment.slug} role={member.role}>
    <header className="dashboard-head"><div><small>CONFIGURAÇÕES</small><h1>Identidade e atendimento.</h1></div></header>
    <SettingsForm establishmentId={establishment.id} initial={{
      name: details?.name ?? establishment.name, description: details?.description ?? "",
      phone: details?.phone ?? "", whatsapp: settings?.whatsapp ?? "",
      address: String(settings?.address?.street ?? ""), city: details?.city ?? "",
      state: details?.state ?? "", accentColor: details?.accent_color ?? "#6d2627",
      secondaryColor: details?.secondary_color ?? "#f5efe5",
      estimatedMinutes: settings?.estimated_minutes ?? 45,
      logoUrl: details?.logo_url ?? "",
    }} />
    <PixSettingsForm establishmentId={establishment.id} initial={pix} />
  </DashboardShell>;
}
