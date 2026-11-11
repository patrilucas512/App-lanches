import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "@/components/ui";
import { getDashboardContext } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

type PublicPlan = {
  id: string; code: string; name: string; description: string | null; monthly_price_cents: number;
  max_products: number | null; max_team_members: number | null; max_monthly_orders: number | null; max_establishments: number | null;
};

const reais = (cents: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((Number(cents) || 0) / 100);
const limit = (value: number | null, one: string, many: string, unlimited: string) => value && value > 0 ? `Até ${value.toLocaleString("pt-BR")} ${value === 1 ? one : many}` : unlimited;

// Tela que aparece quando o teste grátis termina: o painel fica fechado até a loja escolher um plano.
export default async function ChoosePlanPage() {
  const { supabase, establishment, member, billingBlocked } = await getDashboardContext({ allowBlocked: true });
  if (!billingBlocked) redirect("/painel");
  const owner = member.role === "owner";
  const [{ data: plans }, { data: store }] = await Promise.all([
    supabase.from("plans").select("id,code,name,description,monthly_price_cents,max_products,max_team_members,max_monthly_orders,max_establishments").eq("active", true).eq("is_public", true).order("monthly_price_cents"),
    supabase.from("establishments").select("email").eq("id", establishment.id).maybeSingle(),
  ]);
  const list = (plans || []) as PublicPlan[];
  const featuredId = list.at(-1)?.id;

  return <main className="choose-plan-page">
    <header className="choose-plan-top"><Brand /><Link href="/">Voltar ao site</Link></header>
    <section className="pricing-hero">
      <span className="kicker">SEU TESTE GRÁTIS TERMINOU</span>
      <h1>Escolha o plano que vai<br />tocar o seu negócio.</h1>
      <p>Nos últimos 15 dias você usou o MasterApp completo. Seu cardápio, seus pedidos e seus clientes continuam guardados: escolha um dos planos abaixo e continue de onde parou.</p>
    </section>
    {owner ? <>
      <section className="pricing-grid">
        {list.map(plan => {
          const featured = plan.id === featuredId;
          return <article className={`plan-card ${featured ? "featured" : ""}`} key={plan.id}>
            {featured && <span className="tag">O QUE VOCÊ USOU NO TESTE</span>}
            <h2>{plan.name.trim()}</h2>
            <p>{plan.description}</p>
            <div className="price"><small>R$</small><strong>{reais(plan.monthly_price_cents)}</strong><small>/ mês</small></div>
            <Link className={`button wide ${featured ? "primary" : "outline"}`} href={`/assinar/${encodeURIComponent(plan.code)}?ciclo=monthly`}>Continuar com o {plan.name.trim()}</Link>
            <ul>
              <li>{limit(plan.max_products, "produto", "produtos", "Produtos ilimitados")}</li>
              <li>{limit(plan.max_team_members, "pessoa na equipe", "pessoas na equipe", "Equipe sem limite")}</li>
              <li>{limit(plan.max_monthly_orders, "pedido por mês", "pedidos por mês", "Pedidos ilimitados")}</li>
              {plan.max_establishments ? <li>{limit(plan.max_establishments, "loja", "lojas", "")}</li> : null}
            </ul>
          </article>;
        })}
      </section>
      {store?.email && <p className="choose-plan-note">Na contratação, use o e-mail da sua conta, <b>{store.email}</b>, para o plano ser ligado à sua loja na hora.</p>}
    </> : <p className="choose-plan-note">O teste grátis desta loja terminou. Peça ao responsável pela loja para escolher um plano e liberar o painel de novo.</p>}
  </main>;
}
