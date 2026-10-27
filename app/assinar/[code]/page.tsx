import { notFound } from "next/navigation";
import { SaasCheckoutForm } from "@/components/saas-checkout-form";
import { createAdminClient } from "@/lib/supabase/admin";
import { money } from "@/lib/superadmin";

export default async function SubscribePage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ ciclo?: string }> }) {
  const { code } = await params; const query = await searchParams; const cycle = query.ciclo === "annual" ? "annual" : "monthly";
  const admin = createAdminClient();
  const [{ data: plan }, { data: accounts }] = await Promise.all([
    admin.from("plans").select("code,name,description,monthly_price_cents,annual_price_cents,max_establishments,max_products,max_team_members,max_monthly_orders,cashier_enabled,inventory_enabled,staff_management_enabled,drivers_enabled,kitchen_enabled,waiter_mode_enabled").eq("code", code).eq("active", true).maybeSingle(),
    admin.from("platform_payment_accounts").select("provider").eq("active", true).order("provider"),
  ]);
  if (!plan) notFound();
  const value = cycle === "annual" ? plan.annual_price_cents : plan.monthly_price_cents;
  const providers = (accounts || []).map(item => ({ provider: item.provider as "mercado_pago" | "pagarme", label: item.provider === "mercado_pago" ? "Mercado Pago" : "Pagar.me" }));
  const resources = [plan.max_establishments && `${plan.max_establishments} estabelecimento(s)`,plan.max_products && `${plan.max_products} produtos`,plan.max_team_members && `${plan.max_team_members} funcionários`,plan.max_monthly_orders && `${plan.max_monthly_orders} pedidos/mês`,plan.cashier_enabled && "Caixa",plan.inventory_enabled && "Estoque",plan.staff_management_enabled && "Gestão de equipe",plan.drivers_enabled && "Motoboys",plan.kitchen_enabled && "Cozinha",plan.waiter_mode_enabled && "Garçons e mesas"].filter(Boolean);
  return <main className="saas-checkout-page"><section className="saas-checkout-summary"><small>MASTERAPP · CONTRATAÇÃO SEGURA</small><h1>{plan.name}</h1><p>{plan.description}</p><div className="saas-checkout-price"><strong>{money(value)}</strong><span>/{cycle === "annual" ? "ano" : "mês"}</span></div><ul>{resources.map(resource => <li key={String(resource)}>{resource}</li>)}</ul></section><section className="saas-checkout-box"><h2>Dados para contratação</h2><p>Depois de confirmar, você será direcionado ao ambiente seguro do banco.</p><SaasCheckoutForm planCode={plan.code} cycle={cycle} providers={providers} /></section></main>;
}
