import { DashboardShell } from "@/components/dashboard-shell";
import { SaasBillingPortal } from "@/components/saas-billing-portal";
import { getDashboardContext } from "@/lib/dashboard";
import { redirect } from "next/navigation";

export default async function BillingPage() {
  const { supabase, establishment, member } = await getDashboardContext();
  if (member.role !== "owner") redirect("/painel/garcom");
  const organizationId=establishment.organization_id;if(!organizationId)redirect("/onboarding");
  const [{data:snapshot,error},{data:plans}]=await Promise.all([supabase.rpc("get_saas_billing_portal",{requested_organization_id:organizationId}),supabase.from("plans").select("id,name,description,monthly_price_cents,annual_price_cents").eq("active",true).order("sort_order")]);
  return <DashboardShell brand={establishment} active="billing" storeSlug={establishment.slug}><header className="dashboard-head"><div><small>PLANO E COBRANÇA</small><h1>Assinatura do MasterApp.</h1><p>Plano, consumo, faturas e alterações em um único lugar.</p></div></header>{error?<section className="panel"><h2>Não foi possível carregar</h2><p>{error.message}</p></section>:<SaasBillingPortal organizationId={organizationId} snapshot={(snapshot||{}) as never} plans={(plans||[]) as never[]}/>}</DashboardShell>;
}
