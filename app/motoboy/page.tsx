import { EstablishmentTheme } from "@/components/establishment-theme";
import { brandName } from "@/lib/operation-theme";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DriverDispatchConsole } from "@/components/driver-dispatch-console";

export default async function DriverPage() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) redirect("/motoboy/login");
  const { data: driver } = await supabase.from("driver_profiles").select("id,establishment_id,active,approval_status,vehicle_type,driver_kind,custom_staff_members!inner(name,status,employment_type,work_date),establishments!inner(name,logo_url,menu_display_name,menu_logo_url,accent_color,menu_background_color,menu_surface_color,menu_text_color,menu_muted_color)").eq("user_id", userId).maybeSingle();
  if (!driver || !driver.active || driver.approval_status !== "approved") redirect("/motoboy/login");
  const member = Array.isArray(driver.custom_staff_members) ? driver.custom_staff_members[0] : driver.custom_staff_members;
  const establishment = Array.isArray(driver.establishments) ? driver.establishments[0] : driver.establishments;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  if (!member || member.status !== "active" || (member.employment_type === "daily" && member.work_date !== today)) redirect("/motoboy/login");
  const [{ data: availability }, { data: assignments }] = await Promise.all([
    supabase.from("driver_availability").select("driver_profile_id,status,available_since,pause_reason,active_delivery_count").eq("driver_profile_id", driver.id).single(),
    supabase.from("delivery_assignments").select("id,status,offered_at,expires_at,accepted_at,delivery_id,group_suggestion_id,score_breakdown,deliveries(id,status,customer_delivery_fee_cents,orders(order_number,customer_name,total_cents))").eq("driver_profile_id", driver.id).in("status", ["offered", "accepted"]).order("offered_at", { ascending: false }),
  ]);
  if (!availability) redirect("/motoboy/login");
  return <EstablishmentTheme brand={establishment || {}}><DriverDispatchConsole
    establishmentId={driver.establishment_id}
    driverId={driver.id}
    driverKind={driver.driver_kind === "fixed" ? "fixed" : "partner"}
    driverName={member.name}
    establishmentName={brandName(establishment || {})}
    initialAvailability={availability}
    initialAssignments={(assignments || []) as never[]}
  /></EstablishmentTheme>;
}
