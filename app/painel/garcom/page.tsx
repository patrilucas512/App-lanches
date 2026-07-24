import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { WaiterConsole } from "@/components/waiter-console";
import { getDashboardContext } from "@/lib/dashboard";

export default async function WaiterPage() {
  const { supabase, establishment, member, userId } = await getDashboardContext();
  if (!["owner", "manager", "attendant"].includes(member.role)) redirect("/painel");
  const [{ data: tables }, { data: sessions }, { data: products }, { data: categories }] = await Promise.all([
    supabase.from("restaurant_tables").select("*").eq("establishment_id", establishment.id).eq("is_active", true).order("table_number"),
    supabase.from("table_sessions").select("*").eq("establishment_id", establishment.id).in("status", ["open", "awaiting_payment", "paid"]),
    supabase.from("products").select("id,name,description,image_url,price_cents,category_id,product_variations(id,name,price_delta_cents,active),product_addon_groups(addon_groups(id,name,addons(id,name,price_cents,active)))").eq("establishment_id", establishment.id).eq("active", true).order("sort_order"),
    supabase.from("categories").select("id,name").eq("establishment_id", establishment.id).eq("active", true).order("sort_order"),
  ]);
  return <DashboardShell active="waiter" storeSlug={establishment.slug} role={member.role}>
    <header className="dashboard-head"><div><small>OPERAÇÃO DE SALÃO</small><h1>Mesas e pedidos.</h1></div><span className="status-pill">Tempo real</span></header>
    <WaiterConsole establishmentId={establishment.id} establishmentName={establishment.name} userId={userId}
      role={member.role} initialTables={tables || []} initialSessions={sessions || []}
      products={(products || []) as never[]} categories={categories || []} />
  </DashboardShell>;
}
