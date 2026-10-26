import { DashboardShell } from "@/components/dashboard-shell";
import { WaiterCallsManager } from "@/components/waiter-calls-manager";
import { getDashboardContext } from "@/lib/dashboard";
import { operationTheme } from "@/lib/operation-theme";

export const dynamic = "force-dynamic";

export default async function WaiterCallsPage() {
  const { supabase, establishment, member } = await getDashboardContext();
  const { data: calls } = await supabase
    .from("waiter_calls")
    .select("id, establishment_id, table_id, status, customer_note, created_at, attended_at, restaurant_tables(table_number, table_name, sector)")
    .eq("establishment_id", establishment.id)
    .order("created_at", { ascending: false })
    .limit(100);
  return <DashboardShell brand={establishment} active="calls" storeSlug={establishment.slug} role={member.role} operationColors={operationTheme(establishment)}>
    <div className="operation-theme" style={operationTheme(establishment)}>
    <header className="dashboard-head"><div><small>ATENDIMENTO DO SALÃO</small><h1>Chamados de garçom.</h1></div><span className="status-pill">● Atualização em tempo real</span></header>
    <WaiterCallsManager establishmentId={establishment.id} initialCalls={calls ?? []} />
    </div>
  </DashboardShell>;
}
