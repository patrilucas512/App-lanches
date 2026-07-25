import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { WaiterConsole } from "@/components/waiter-console";
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
  const [{ data: tables }, { data: sessions }, { data: products }, { data: categories }, { data: serviceMode }, { data: waiter }] = await Promise.all([
    supabase.from("restaurant_tables").select("*").eq("establishment_id", establishment.id).eq("is_active", true).order("table_number"),
    supabase.from("table_sessions").select("*").eq("establishment_id", establishment.id).in("status", ["open", "awaiting_payment", "paid"]),
    supabase.from("products").select("id,name,description,image_url,price_cents,category_id,product_variations(id,name,price_delta_cents,active),product_addon_groups(addon_groups(id,name,addons(id,name,price_cents,active)))").eq("establishment_id", establishment.id).eq("active", true).order("sort_order"),
    supabase.from("categories").select("id,name").eq("establishment_id", establishment.id).eq("active", true).order("sort_order"),
    supabase.from("service_modes").select("*").eq("establishment_id", establishment.id).single(),
    supabase.from("waiters").select("id,status,active_now,permissions,employment_type,work_date").eq("establishment_id", establishment.id).eq("user_id", userId).maybeSingle(),
  ]);
  const outsideDailyDate = waiter?.employment_type === "daily" && waiter.work_date !== saoPauloDate();
  if (member.role === "attendant" && (!serviceMode?.waiter_mode_enabled || !waiter?.active_now || outsideDailyDate || ["inactive", "paused", "blocked"].includes(waiter?.status || ""))) redirect("/garcom/login");
  return <DashboardShell active="waiter" storeSlug={establishment.slug} role={member.role}>
    <header className="dashboard-head"><div><small>OPERAÇÃO DE SALÃO</small><h1>Mesas e pedidos.</h1></div><span className="status-pill">Tempo real</span></header>
    <WaiterConsole establishmentId={establishment.id} establishmentName={establishment.name} userId={userId}
      role={member.role} initialTables={tables || []} initialSessions={sessions || []}
      products={(products || []) as never[]} categories={categories || []}
      serviceMode={serviceMode as never} />
  </DashboardShell>;
}
