import { redirect } from "next/navigation";
import { KitchenBoard } from "@/components/kitchen-board";
import { getDashboardContext } from "@/lib/dashboard";

export default async function KitchenPage() {
  const { supabase, establishment, member } = await getDashboardContext();
  if (!["owner", "manager", "attendant"].includes(member.role)) redirect("/painel");
  const [{ data: tickets }, { data: orders }, { data: sessions }, { data: tables }, { data: items }] = await Promise.all([
    supabase.from("kitchen_tickets").select("*").eq("establishment_id", establishment.id).neq("status", "canceled").order("created_at"),
    supabase.from("table_orders").select("*").eq("establishment_id", establishment.id).order("created_at"),
    supabase.from("table_sessions").select("id,table_id").eq("establishment_id", establishment.id),
    supabase.from("restaurant_tables").select("id,table_number,table_name").eq("establishment_id", establishment.id),
    supabase.from("table_order_items").select("*").eq("establishment_id", establishment.id).order("created_at"),
  ]);
  return <KitchenBoard establishmentId={establishment.id} establishmentName={establishment.name}
    initial={{ tickets: tickets || [], orders: orders || [], sessions: sessions || [], tables: tables || [], items: items || [] }} />;
}
