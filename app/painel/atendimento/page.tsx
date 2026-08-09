import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { AttendanceManager } from "@/components/attendance-manager";
import { getDashboardContext } from "@/lib/dashboard";

export default async function AttendancePage() {
  const { supabase, establishment, member } = await getDashboardContext();
  if (!["owner", "manager"].includes(member.role)) redirect("/painel/garcom");
  const [{ data: mode }, { data: waiters }, { data: orders }, { data: sessions }, { data: payments }] = await Promise.all([
    supabase.from("service_modes").select("*").eq("establishment_id", establishment.id).single(),
    supabase.from("waiters").select("*").eq("establishment_id", establishment.id).order("name"),
    supabase.from("table_orders").select("waiter_id").eq("establishment_id", establishment.id),
    supabase.from("table_sessions").select("waiter_id,total_cents").eq("establishment_id", establishment.id),
    supabase.from("table_payments").select("waiter_id,amount_cents").eq("establishment_id", establishment.id),
  ]);
  const metrics = (waiters || []).map(waiter => ({
    waiterId: waiter.id,
    orders: (orders || []).filter(order => order.waiter_id === waiter.user_id).length,
    tables: (sessions || []).filter(session => session.waiter_id === waiter.user_id).length,
    salesCents: (payments || []).filter(payment => payment.waiter_id === waiter.id).reduce((sum, payment) => sum + payment.amount_cents, 0),
    payments: (payments || []).filter(payment => payment.waiter_id === waiter.id).length,
  }));
  return <DashboardShell active="attendance" storeSlug={establishment.slug} role={member.role}>
    <header className="dashboard-head"><div><small>OPERAÇÃO PERSONALIZADA</small><h1>Modo de atendimento.</h1></div><span className="status-pill">Configurável</span></header>
    <AttendanceManager establishmentId={establishment.id} slug={establishment.slug} initialMode={mode as never} initialWaiters={(waiters || []) as never[]} metrics={metrics} section="mode" />
  </DashboardShell>;
}
