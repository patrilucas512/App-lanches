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
  const { data: establishment } = await supabase.from("establishments").select("id,name,slug").eq("id", member.establishment_id).single();
  if (!establishment) redirect("/cozinha/login");
  const { data: operator } = member.role === "kitchen" ? await supabase.from("kitchen_operators").select("name,status,access_type,work_date,permissions").eq("establishment_id", establishment.id).eq("user_id", userId).maybeSingle() : { data: null };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  if (member.role === "kitchen" && (!operator || operator.status !== "active" || (operator.access_type === "daily" && operator.work_date !== today))) redirect("/cozinha/login");
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
  return <KitchenBoard establishmentId={establishment.id} establishmentName={establishment.name} operatorName={operator?.name || (member.role === "owner" ? "Administrador" : "Gerente")} canPrint={member.role !== "kitchen" || operator?.permissions?.print_orders !== false} autoPrint={serviceMode?.auto_print_kitchen ?? false} paperWidth={serviceMode?.printer_paper_width === 80 ? 80 : 58} initial={{ tickets: tickets || [], tableOrders: tableOrders || [], publicOrders: publicOrders || [], sessions: sessions || [], tables: tables || [], tableItems: tableItems || [], publicItems: publicItems || [] }} />;
}
