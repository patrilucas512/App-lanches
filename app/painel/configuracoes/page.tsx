import { DashboardShell } from "@/components/dashboard-shell";
import { SettingsForm } from "@/components/settings-form";
import { PixSettingsForm } from "@/components/pix-settings-form";
import { PrinterSetupWizard } from "@/components/printer-setup-wizard";
import { KitchenAccessManager } from "@/components/kitchen-access";
import { getDashboardContext } from "@/lib/dashboard";
import { redirect } from "next/navigation";

export default async function SettingsPage() {
  const { supabase, establishment, member } = await getDashboardContext();
  if (!["owner", "manager"].includes(member.role)) redirect("/painel/garcom");
  const [{ data: details }, { data: settings }, { data: pix }, { data: printer }, { data: kitchenOperators }] = await Promise.all([
    supabase.from("establishments").select("*").eq("id", establishment.id).single(),
    supabase.from("establishment_settings").select("*").eq("establishment_id", establishment.id).single(),
    supabase.from("pix_settings").select("*").eq("establishment_id", establishment.id).maybeSingle(),
    supabase.from("service_modes").select("printer_connection,printer_name,printer_paper_width,printer_network_address,printer_setup_completed,auto_print_kitchen").eq("establishment_id", establishment.id).maybeSingle(),
    supabase.from("kitchen_operators").select("id,user_id,name,phone,status,access_type,work_date,device_mode,permissions").eq("establishment_id", establishment.id).order("created_at"),
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
    <KitchenAccessManager establishmentId={establishment.id} initialOperators={(kitchenOperators || []) as never[]} />
    <PrinterSetupWizard establishmentId={establishment.id} establishmentName={details?.name ?? establishment.name} initial={{ connection: printer?.printer_connection ?? "usb", name: printer?.printer_name ?? "", paperWidth: printer?.printer_paper_width === 80 ? 80 : 58, networkAddress: printer?.printer_network_address ?? "", autoPrint: printer?.auto_print_kitchen ?? false, completed: printer?.printer_setup_completed ?? false }} />
    <PixSettingsForm establishmentId={establishment.id} initial={pix} />
  </DashboardShell>;
}
