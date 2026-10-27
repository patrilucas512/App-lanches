import { EstablishmentTheme } from "@/components/establishment-theme";
import { brandName } from "@/lib/operation-theme";
import { redirect } from "next/navigation";
import { KitchenBoard } from "@/components/kitchen-board";
import { createClient } from "@/lib/supabase/server";

export default async function KitchenPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/cozinha/login");
  const { data: member } = await supabase.from("establishment_members").select("establishment_id,role").eq("user_id", userId).limit(1).maybeSingle();
  if (!member || !["owner", "manager", "kitchen"].includes(member.role)) redirect("/cozinha/login");
  const { data: establishment } = await supabase.from("establishments").select("id,slug,name,logo_url,menu_display_name,menu_logo_url,accent_color,menu_background_color,menu_surface_color,menu_text_color,menu_muted_color").eq("id", member.establishment_id).single();
  if (!establishment) redirect("/cozinha/login");
  const { data: operator } = member.role === "kitchen" ? await supabase.from("kitchen_operators").select("name,status,access_type,work_date,permissions").eq("establishment_id", establishment.id).eq("user_id", userId).maybeSingle() : { data: null };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  if (member.role === "kitchen" && (!operator || operator.status !== "active" || (operator.access_type === "daily" && operator.work_date !== today))) redirect("/cozinha/login");
  const [{ data: tickets }, { data: tableOrders }, { data: publicOrders }, { data: deliveries }, { data: deliveryDestinations }, { data: sessions }, { data: tables }, { data: tableItems }, { data: publicItems }, { data: serviceMode }, { data: directPrinter }, { data: businessHours }] = await Promise.all([
    supabase.from("kitchen_tickets").select("*").eq("establishment_id", establishment.id).neq("status", "canceled").order("created_at"),
    supabase.from("table_orders").select("id,table_session_id,order_number,notes").eq("establishment_id", establishment.id),
    supabase.from("orders").select("id,order_number,notes,customer_name,fulfillment_type,restaurant_table_id,payment_method,total_cents,cash_received_cents,cash_change_cents").eq("establishment_id", establishment.id),
    supabase.from("deliveries").select("id,order_id,status,ready_at").eq("establishment_id", establishment.id),
    supabase.from("delivery_destinations").select("delivery_order_id,recipient_name,recipient_phone,postal_code,street,street_number,complement,neighborhood,city,state,reference").eq("establishment_id", establishment.id),
    supabase.from("table_sessions").select("id,table_id,customer_name").eq("establishment_id", establishment.id),
    supabase.from("restaurant_tables").select("id,table_number,table_name").eq("establishment_id", establishment.id),
    supabase.from("table_order_items").select("id,table_order_id,product_name,quantity,notes,addons,removed_ingredients").eq("establishment_id", establishment.id),
    supabase.from("order_items").select("id,order_id,product_name,quantity,notes,addons,removed_ingredients").eq("establishment_id", establishment.id),
    supabase.from("service_modes").select("auto_print_kitchen,printer_paper_width").eq("establishment_id", establishment.id).maybeSingle(),
    supabase.rpc("get_printer_connector_status", { requested_establishment_id: establishment.id }),
    supabase.from("business_hours").select("weekday,opens_at,closes_at,closed").eq("establishment_id", establishment.id).order("weekday"),
  ]);
  return <EstablishmentTheme brand={establishment || {}}><KitchenBoard establishmentId={establishment.id} establishmentName={brandName(establishment)} operatorName={operator?.name || (member.role === "owner" ? "Administrador" : "Gerente")} canReturnToAdmin={member.role === "owner" || member.role === "manager"} canPrint={member.role !== "kitchen" || operator?.permissions?.print_orders !== false} autoPrint={serviceMode?.auto_print_kitchen ?? false} paperWidth={serviceMode?.printer_paper_width === 80 ? 80 : 58} directPrinter={(directPrinter || { configured: false, online: false }) as never} businessHours={businessHours || []} initial={{ tickets: tickets || [], tableOrders: tableOrders || [], publicOrders: publicOrders || [], deliveries: deliveries || [], deliveryDestinations: deliveryDestinations || [], sessions: sessions || [], tables: tables || [], tableItems: tableItems || [], publicItems: publicItems || [] }} /></EstablishmentTheme>;
}
