import Link from "next/link";
import { MarketingHeader } from "@/components/ui";

const plans = [
  { name: "Essencial", price: "49", text: "Para começar com uma presença profissional.", items: ["Até 60 produtos", "2 membros na equipe", "Pedidos ilimitados", "Link do cardápio"] },
  { name: "Crescimento", price: "99", text: "Para operações em expansão.", items: ["Até 250 produtos", "8 membros na equipe", "Cupons e clientes", "Relatórios essenciais"], featured: true },
  { name: "Escala", price: "199", text: "Para marcas com alto volume.", items: ["Produtos ilimitados", "Equipe ilimitada", "Recursos avançados", "Suporte prioritário"] },
];

export default function PricingPage() {
  return <main><MarketingHeader /><section className="pricing-hero"><span className="kicker">PLANOS TRANSPARENTES</span><h1>Comece pequeno.<br />Cresça sem limites.</h1><p>Teste todos os recursos por 14 dias. Escolha seu plano quando estiver pronto.</p></section><section className="pricing-grid">{plans.map(plan => <article className={`plan-card ${plan.featured ? "featured" : ""}`} key={plan.name}>{plan.featured && <span className="tag">MAIS ESCOLHIDO</span>}<h2>{plan.name}</h2><p>{plan.text}</p><div className="price"><small>R$</small><strong>{plan.price}</strong><small>/ mês</small></div><Link className={`button wide ${plan.featured ? "primary" : "outline"}`} href={`/cadastro?plano=${plan.name.toLowerCase()}`}>Testar grátis</Link><ul>{plan.items.map(item => <li key={item}>{item}</li>)}</ul></article>)}</section></main>;
}
