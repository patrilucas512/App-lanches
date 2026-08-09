import { redirect } from "next/navigation";
import { KitchenBoard } from "@/components/kitchen-board";
import { getDashboardContext } from "@/lib/dashboard";

export default async function KitchenPage() {
  const { supabase, establishment, member } = await getDashboardContext();
  if (!["owner", "manager", "attendant"].includes(member.role)) redirect("/painel");
  const [{ data: tickets }, { data: tableOrders }, { data: publicOrders }, { data: sessions }, { data: tables }, { data: tableItems }, { data: publicItems }, { data: serviceMode }] = await Promise.all([
    supabase.from("kitchen_tickets").select("*").eq("establishment_id", establishment.id).neq("status", "canceled").order("created_at"),
    supabase.from("table_orders").select("id,table_session_id,order_number,notes").eq("establishment_id", establishment.id),
    supabase.from("orders").select("id,order_number,notes,customer_name,fulfillment_type,restaurant_table_id,payment_method").eq("establishment_id", establishment.id),
    supabase.from("table_sessions").select("id,table_id,customer_name").eq("establishment_id", establishment.id),
    supabase.from("restaurant_tables").select("id,table_number,table_name").eq("establishment_id", establishment.id),
    supabase.from("table_order_items").select("id,table_order_id,product_name,quantity,notes,addons,removed_ingredients").eq("establishment_id", establishment.id),
    supabase.from("order_items").select("id,order_id,product_name,quantity,notes,addons,removed_ingredients").eq("establishment_id", establishment.id),
    supabase.from("service_modes").select("auto_print_kitchen,printer_paper_width").eq("establishment_id", establishment.id).maybeSingle(),
  ]);
  return <KitchenBoard establishmentId={establishment.id} establishmentName={establishment.name} autoPrint={serviceMode?.auto_print_kitchen ?? false} paperWidth={serviceMode?.printer_paper_width === 80 ? 80 : 58} initial={{ tickets: tickets || [], tableOrders: tableOrders || [], publicOrders: publicOrders || [], sessions: sessions || [], tables: tables || [], tableItems: tableItems || [], publicItems: publicItems || [] }} />;
}
