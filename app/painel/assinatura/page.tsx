import { DashboardShell } from "@/components/dashboard-shell";
import { BillingActions } from "@/components/billing-actions";
import { getDashboardContext } from "@/lib/dashboard";

export default async function BillingPage() {
  const { supabase, establishment } = await getDashboardContext();
  const { data: subscription } = await supabase.from("subscriptions").select("status, billing_cycle, trial_ends_at, current_period_end, stripe_customer_id, plans(name, monthly_price_cents)").eq("establishment_id", establishment.id).single();
  const plan = subscription?.plans as unknown as { name?: string; monthly_price_cents?: number };
  return <DashboardShell active="billing" storeSlug={establishment.slug}><header className="dashboard-head"><div><small>ASSINATURA</small><h1>Plano e cobrança.</h1></div><span className="status-pill">{subscription?.status ?? "trialing"}</span></header><div className="panel-grid"><article className="panel"><h2>{plan?.name ?? "Essencial"}</h2><p>Seu período de teste e o estado da assinatura são sincronizados pelo Stripe.</p><div className="dash-card"><small>PRÓXIMA RENOVAÇÃO / FIM DO TESTE</small><strong>{subscription?.current_period_end || subscription?.trial_ends_at ? new Date(subscription.current_period_end ?? subscription.trial_ends_at!).toLocaleDateString("pt-BR") : "—"}</strong></div></article><article className="panel"><h2>Gerenciar</h2><BillingActions /></article></div></DashboardShell>;
}
