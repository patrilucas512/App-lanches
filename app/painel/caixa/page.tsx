import { redirect } from "next/navigation";
import { CashierManager } from "@/components/cashier-manager";
import { DashboardShell } from "@/components/dashboard-shell";
import { getDashboardContext } from "@/lib/dashboard";

export default async function CashierPage() {
  const { supabase, establishment, member, userId } = await getDashboardContext();
  if (!["owner", "manager"].includes(member.role)) redirect("/painel");
  const [{ data: employees }, { data: movements }, { data: payments }] = await Promise.all([
    supabase.from("custom_staff_members").select("id,role_id,name,status,staff_roles!inner(name,financial_role)").eq("establishment_id", establishment.id).eq("staff_roles.financial_role", true).order("name"),
    supabase.from("cash_movements").select("id,staff_member_id,operator_name,movement_type,category,payment_method,amount_cents,description,reference,occurred_at").eq("establishment_id", establishment.id).order("occurred_at", { ascending: false }).limit(500),
    supabase.from("table_payments").select("id,waiter_name,payment_method,amount_cents,table_number,confirmed_at").eq("establishment_id", establishment.id).order("confirmed_at", { ascending: false }).limit(500),
  ]);
  return <DashboardShell active="cashier" storeSlug={establishment.slug} role={member.role}><header className="dashboard-head"><div><small>FINANCEIRO E RESPONSABILIDADE</small><h1>Caixa.</h1><p>Equipe, recebimentos e saídas identificados pelo nome de quem realizou cada operação.</p></div><span className="status-pill">Controle ativo</span></header><CashierManager establishmentId={establishment.id} userId={userId} employees={(employees || []) as never[]} initialMovements={(movements || []) as never[]} tablePayments={(payments || []) as never[]} /></DashboardShell>;
}
