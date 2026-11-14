import { PlanForm } from "@/components/superadmin-actions";
import { PlanCheckoutLinks } from "@/components/plan-checkout-links";
import { Badge, Empty, PageHead } from "@/components/superadmin-ui";
import { money, requireSuperadmin } from "@/lib/superadmin";
import { SaasPlanFeatureEditor } from "@/components/saas-plan-feature-editor";

// Os planos ficam no topo, em cartões. O formulário (grande) só abre quando a pessoa clica em
// "Criar novo plano" ou "Editar plano", para os planos não sumirem no meio da página.
export default async function PlansPage() {
  const { supabase } = await requireSuperadmin();
  const [{ data: plans }, { data: features }, { data: values }] = await Promise.all([
    supabase.from("plans").select("*").order("sort_order"),
    supabase.from("saas_features").select("*").order("name"),
    supabase.from("saas_plan_features").select("*"),
  ]);
  return <>
    <PageHead title="Planos" description="Defina nome, preço, limites e funções de cada plano. Clique em Editar plano para mudar um plano existente." />
    <details className="sa-panel sa-plan-create">
      <summary><span>+ Criar novo plano</span><small>Abre o formulário com preço, limites e funções</small></summary>
      <PlanForm />
    </details>
    <section className="sa-plan-list" aria-label="Seus planos">
      {plans?.map((plan: any) => <article className="sa-panel sa-plan-card" key={plan.id}>
        <header><div><small>CÓDIGO: {plan.code}</small><h2>{plan.name}</h2></div><Badge value={plan.active ? "Ativo" : "Inativo"} /></header>
        <div className="sa-price"><b>{money(plan.monthly_price_cents)}<small>/mês</small></b><span>{money(plan.annual_price_cents)} / ano</span></div>
        {plan.description ? <p className="sa-plan-description">{plan.description}</p> : null}
        <PlanCheckoutLinks code={plan.code} active={plan.active} />
        <details className="sa-plan-edit">
          <summary>Editar plano (nome, preço, limites e funções)</summary>
          <PlanForm plan={plan} />
        </details>
        <SaasPlanFeatureEditor planId={plan.id} features={(features || []) as never[]} values={(values || []).filter((x: any) => x.plan_id === plan.id) as never[]} />
      </article>)}
      {!plans?.length && <Empty title="Nenhum plano" text="Clique em Criar novo plano para começar." />}
    </section>
  </>;
}
