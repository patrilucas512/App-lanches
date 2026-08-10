import { DashboardShell } from "@/components/dashboard-shell";
import { SettingsForm } from "@/components/settings-form";
import { PixSettingsForm } from "@/components/pix-settings-form";
import { MultiPrinterManager } from "@/components/multi-printer-manager";
import { KitchenAccessManager } from "@/components/kitchen-access";
import { BusinessHoursForm } from "@/components/business-hours-form";
import { getDashboardContext } from "@/lib/dashboard";
import { redirect } from "next/navigation";

export default async function SettingsPage() {
  const { supabase, establishment, member } = await getDashboardContext();
  if (!["owner", "manager"].includes(member.role)) redirect("/painel/garcom");
  const [{ data: details }, { data: settings }, { data: pix }, { data: kitchenOperators }, { data: printers }, { data: registers }, { data: businessHours }] = await Promise.all([
    supabase.from("establishments").select("*").eq("id", establishment.id).single(),
    supabase.from("establishment_settings").select("*").eq("establishment_id", establishment.id).single(),
    supabase.from("pix_settings").select("*").eq("establishment_id", establishment.id).maybeSingle(),
    supabase.from("kitchen_operators").select("id,user_id,name,phone,status,access_type,work_date,device_mode,permissions,payment_cycle").eq("establishment_id", establishment.id).order("created_at"),
    supabase.rpc("list_printer_devices", { requested_establishment_id: establishment.id }),
    supabase.from("cash_registers").select("id,name,active").eq("establishment_id",establishment.id).order("created_at"),
    supabase.from("business_hours").select("weekday,opens_at,closes_at,closed").eq("establishment_id", establishment.id).order("weekday"),
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
    <BusinessHoursForm establishmentId={establishment.id} initial={businessHours || []} />
    <KitchenAccessManager establishmentId={establishment.id} initialOperators={(kitchenOperators || []) as never[]} />
    <MultiPrinterManager establishmentId={establishment.id} establishmentName={details?.name ?? establishment.name} initialDevices={(printers || []) as never[]} initialRegisters={(registers || []) as never[]} />
    <PixSettingsForm establishmentId={establishment.id} initial={pix} />
  </DashboardShell>;
}
