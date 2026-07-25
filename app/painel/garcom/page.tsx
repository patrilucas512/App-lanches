import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { WaiterConsole } from "@/components/waiter-console";
import { WaiterOrderTracker } from "@/components/waiter-order-tracker";
import { getDashboardContext } from "@/lib/dashboard";

function saoPauloDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export default async function WaiterPage() {
  const { supabase, establishment, member, userId } = await getDashboardContext();
  if (!["owner", "manager", "attendant"].includes(member.role)) redirect("/painel");
  const [{ data: tables }, { data: sessions }, { data: products }, { data: categories }, { data: serviceMode }, { data: waiter }, { data: tickets }, { data: orders }] = await Promise.all([
    supabase.from("restaurant_tables").select("*").eq("establishment_id", establishment.id).eq("is_active", true).order("table_number"),
    supabase.from("table_sessions").select("*").eq("establishment_id", establishment.id).in("status", ["open", "awaiting_payment", "paid"]),
    supabase.from("products").select("id,name,description,image_url,price_cents,category_id,product_variations(id,name,price_delta_cents,active),product_addon_groups(addon_groups(id,name,addons(id,name,price_cents,active)))").eq("establishment_id", establishment.id).eq("active", true).order("sort_order"),
    supabase.from("categories").select("id,name").eq("establishment_id", establishment.id).eq("active", true).order("sort_order"),
    supabase.from("service_modes").select("*").eq("establishment_id", establishment.id).single(),
    supabase.from("waiters").select("id,status,active_now,permissions,employment_type,work_date").eq("establishment_id", establishment.id).eq("user_id", userId).maybeSingle(),
    supabase.from("kitchen_tickets").select("*").eq("establishment_id", establishment.id).neq("status", "canceled").order("created_at", { ascending: false }).limit(100),
    supabase.from("table_orders").select("id,table_session_id,order_number,created_at").eq("establishment_id", establishment.id).order("created_at", { ascending: false }).limit(100),
  ]);
  const outsideDailyDate = waiter?.employment_type === "daily" && waiter.work_date !== saoPauloDate();
  if (member.role === "attendant" && (!serviceMode?.waiter_mode_enabled || !waiter?.active_now || outsideDailyDate || ["inactive", "paused", "blocked"].includes(waiter?.status || ""))) redirect("/garcom/login");
  return <DashboardShell active="waiter" storeSlug={establishment.slug} role={member.role}>
    <header className="dashboard-head"><div><small>OPERAÇÃO DE SALÃO</small><h1>Mesas e pedidos.</h1></div><span className="status-pill">Tempo real</span></header>
    <WaiterOrderTracker establishmentId={establishment.id} initial={{
      tickets: tickets || [], orders: orders || [], sessions: (sessions || []).map(session => ({ id: session.id, table_id: session.table_id })),
      tables: (tables || []).map(table => ({ id: table.id, table_number: table.table_number })),
    }} />
    <WaiterConsole establishmentId={establishment.id} establishmentName={establishment.name} userId={userId}
      role={member.role} initialTables={tables || []} initialSessions={sessions || []}
      products={(products || []) as never[]} categories={categories || []}
      serviceMode={serviceMode as never} />
  </DashboardShell>;
}
