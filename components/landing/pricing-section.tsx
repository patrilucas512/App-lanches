import { useState } from "react";
import { ArrowRight, Check, ChevronDown } from "lucide-react";
import { Button } from "./button";
import { SaasAccessButton } from "./saas-access-button";

type Billing = "monthly" | "annual";

const checkoutLinks = {
  "Básico": {
    monthly: "/assinar/MasterApp?ciclo=monthly",
    annual: "/assinar/MasterApp?ciclo=annual",
  },
  "Profissional": {
    monthly: "/assinar/MAsterApp%20?ciclo=monthly",
    annual: "/assinar/MAsterApp%20?ciclo=annual",
  },
  "Profissional Sênior": {
    monthly: "/assinar/Profissional%20s%C3%AAnior?ciclo=monthly",
    annual: "/assinar/Profissional%20s%C3%AAnior?ciclo=annual",
  },
} as const satisfies Record<string, Record<Billing, string>>;

const plans = [
  {
    name: "Básico",
    profile: "Ideal para começar com mais organização",
    description: "Para pequenos estabelecimentos que querem organizar pedidos, atendimento e operação em um único sistema.",
    focus: "Organizar o início da operação",
    primary: "Começar agora",
    order: "order-2 lg:order-1",
    featured: false,
  },
  {
    name: "Profissional",
    profile: "Ideal para equipes em crescimento",
    description: "Para estabelecimentos que já têm movimento e precisam de mais agilidade, controle e organização na operação.",
    focus: "Acompanhar o ritmo da equipe",
    primary: "Quero profissionalizar minha operação",
    order: "order-1 lg:order-2",
    featured: true,
  },
  {
    name: "Profissional Sênior",
    profile: "Para operações que precisam de mais liberdade",
    description: "Para operações maiores que precisam de liberdade para crescer, ampliar equipes, pontos de venda, pedidos e estabelecimentos sem os limites dos planos anteriores.",
    focus: "Crescer sem os limites de uso dos planos anteriores",
    primary: "Quero gestão sem limites",
    order: "order-3",
    featured: false,
  },
] as const;

// Values supplied for this presentation. Replace with administrative plan data if a connection is added later.
const basicPlan = {
  monthly: 49.90,
  annual: 390,
  limits: {
    establishments: 1,
    products: 100,
    employees: 5,
    pdv: 1,
    stockItems: 100,
    waiterMode: 1,
    deliverySystem: 1,
    qrCodes: null,
    monthlyOrders: 500,
  },
} as const;

// Supplied presentation terms; this page has no administrative plan connection.
const professionalPlan = {
  monthly: 89.90,
  annual: 990,
  limits: {
    establishments: 2,
    products: null,
    employees: 15,
    pdv: 4,
    stockItems: null,
    waiterMode: 1,
    deliverySystem: 2,
    qrCodes: null,
    monthlyOrders: 2000,
  },
} as const;

// Presentation data supplied for this card; modules were not confirmed in the brief.
const seniorPlan = {
  monthly: 169.90,
  annual: 1738.90,
  limits: {
    establishments: null,
    products: null,
    employees: null,
    pdv: null,
    stockItems: null,
    waiterMode: null,
    deliverySystem: null,
    qrCodes: null,
    monthlyOrders: null,
    printers: null,
  },
} as const;

function unlimitedLabel(value: number | null | undefined, label: string, unlimited: string) {
  return value == null ? `${label} ${unlimited}` : `${label}: ${value.toLocaleString("pt-BR")}`;
}

function limit(value: number | null | undefined, singular: string, plural: string, prefix = "Até ") {
  return value == null ? `${plural} ilimitados` : `${prefix}${value} ${value === 1 ? singular : plural}`;
}

const basicLimits = basicPlan.limits;
const basicHighlights = [
  "Sistema PDV de caixa",
  "Modo Garçom integrado",
  "Sistema de Entrega",
  limit(basicLimits.qrCodes, "QR Code", "QR Codes", ""),
  limit(basicLimits.monthlyOrders, "pedido por mês", "pedidos por mês"),
  "Gestão de produtos, estoque e equipe",
];
const basicGroups = [
  { title: "Seu estabelecimento", items: [
    { label: limit(basicLimits.establishments, "estabelecimento", "estabelecimentos", ""), description: "Gerencie uma operação dentro do plano." },
    { label: limit(basicLimits.products, "produto", "produtos"), description: "Cadastre e organize seu catálogo e cardápio." },
    { label: limit(basicLimits.stockItems, "item de estoque", "itens de estoque"), description: "Mantenha os itens da operação organizados." },
    { label: limit(basicLimits.monthlyOrders, "pedido por mês", "pedidos por mês"), description: "Estrutura para acompanhar o volume de pedidos do estabelecimento." },
    { label: limit(basicLimits.qrCodes, "QR Code", "QR Codes", ""), description: "Gere os acessos necessários ao cardápio." },
  ] },
  { title: "Equipe e atendimento", items: [
    { label: limit(basicLimits.employees, "funcionário", "funcionários"), description: "Organize os acessos da equipe dentro do limite do plano." },
    { label: `${basicLimits.waiterMode} Modo Garçom incluído`, description: "Apoie o atendimento no estabelecimento." },
  ] },
  { title: "Caixa", items: [
    { label: `${basicLimits.pdv} Sistema PDV de caixa incluído`, description: "O sistema de caixa faz parte da estrutura do plano." },
  ] },
  { title: "Entrega", items: [
    { label: `${basicLimits.deliverySystem} Sistema de Entrega incluído`, description: "Organize também os pedidos destinados à entrega." },
  ] },
];

const professionalLimits = professionalPlan.limits;
const professionalHighlights = [
  limit(professionalLimits.establishments, "estabelecimento", "estabelecimentos"),
  limit(professionalLimits.products, "Produto", "Produtos", ""),
  `Até ${professionalLimits.monthlyOrders.toLocaleString("pt-BR")} pedidos/mês`,
  `Até ${professionalLimits.pdv} PDVs de caixa`,
  "Sistema de Entrega integrado",
  "Cozinha em tempo real",
  "Estoque ilimitado",
  limit(professionalLimits.qrCodes, "QR Code", "QR Codes", ""),
];
const professionalGroups = [
  { title: "Capacidade da operação", items: [
    { label: limit(professionalLimits.establishments, "estabelecimento", "estabelecimentos"), description: "Gerencie até duas operações dentro do mesmo plano." },
    { label: limit(professionalLimits.products, "Produto", "Produtos", ""), description: "Cadastre seu catálogo sem limite numérico de produtos neste plano." },
    { label: `Até ${professionalLimits.monthlyOrders.toLocaleString("pt-BR")} pedidos por mês`, description: "Capacidade para uma operação com maior volume de pedidos." },
    { label: limit(professionalLimits.stockItems, "Item de estoque", "Itens de estoque", ""), description: "Organize itens e movimentações sem limite numérico de itens cadastrados." },
    { label: limit(professionalLimits.qrCodes, "QR Code", "QR Codes", ""), description: "Utilize os QR Codes necessários para a operação." },
  ] },
  { title: "Equipe e atendimento", items: [
    { label: limit(professionalLimits.employees, "funcionário", "funcionários"), description: "Cadastre e organize uma equipe maior." },
    { label: `${professionalLimits.waiterMode} Modo Garçom incluído`, description: "Atendimento por garçom, mesas e pedidos." },
    { label: "Gestão de funcionários", description: "Cadastro e gestão da equipe dentro do sistema." },
  ] },
  { title: "PDV e caixa", items: [
    { label: `Até ${professionalLimits.pdv} Sistemas PDV de caixa`, description: "Trabalhe com múltiplos pontos de caixa dentro do limite do plano." },
    { label: "Vendas e recebimentos", description: "Centralize as operações realizadas pelo PDV." },
    { label: "Fechamento de caixa", description: "Acompanhe o fechamento da operação." },
  ] },
  { title: "Cozinha integrada", description: ["Do pedido ao preparo: acompanhe as comandas e a produção em tempo real."], items: [
    { label: "Comandas em tempo real" },
    { label: "Produção dos pedidos" },
    { label: "Integração da operação com a cozinha" },
  ] },
  { title: "Delivery e entregas", description: ["Organize o fluxo de entrega junto ao restante da operação."], items: [
    { label: `Até ${professionalLimits.deliverySystem} Sistemas de Entrega` },
    { label: "Gestão de entregadores" },
    { label: "Despacho dos pedidos" },
    { label: "Acompanhamento das entregas" },
  ] },
  { title: "Estoque", description: ["Acompanhe itens, receitas e movimentações no mesmo sistema."], items: [
    { label: limit(professionalLimits.stockItems, "Item de estoque", "Itens de estoque", "") },
    { label: "Receitas" },
    { label: "Movimentações de estoque" },
  ] },
];

const seniorLimits = seniorPlan.limits;
const seniorItems = {
  establishments: unlimitedLabel(seniorLimits.establishments, "Estabelecimentos", "ilimitados"),
  products: unlimitedLabel(seniorLimits.products, "Produtos", "ilimitados"),
  employees: unlimitedLabel(seniorLimits.employees, "Funcionários", "ilimitados"),
  pdv: unlimitedLabel(seniorLimits.pdv, "PDVs de caixa", "ilimitados"),
  stockItems: unlimitedLabel(seniorLimits.stockItems, "Itens de estoque", "ilimitados"),
  waiterMode: unlimitedLabel(seniorLimits.waiterMode, "Modo Garçom", "ilimitado"),
  deliverySystem: unlimitedLabel(seniorLimits.deliverySystem, "Sistemas de Entrega", "ilimitados"),
  qrCodes: unlimitedLabel(seniorLimits.qrCodes, "QR Codes", "ilimitados"),
  monthlyOrders: unlimitedLabel(seniorLimits.monthlyOrders, "Pedidos mensais", "ilimitados"),
  printers: unlimitedLabel(seniorLimits.printers, "Impressoras", "ilimitadas"),
};
const seniorHighlights = [seniorItems.establishments, seniorItems.products, seniorItems.employees, seniorItems.pdv, seniorItems.monthlyOrders, seniorItems.deliverySystem, seniorItems.stockItems, seniorItems.qrCodes, seniorItems.printers];
const seniorGroups = [
  { title: "Expanda sua operação", items: [{ label: seniorItems.establishments, description: "Cadastre e administre estabelecimentos sem limite numérico configurado neste plano." }] },
  { title: "Produtos e estoque", items: [
    { label: seniorItems.products, description: "Cadastre produtos sem limite numérico configurado neste plano." },
    { label: seniorItems.stockItems, description: "Cadastre itens de estoque sem limite numérico configurado neste plano." },
  ] },
  { title: "Equipe", items: [{ label: seniorItems.employees, description: "Cadastre sua equipe sem limite numérico configurado neste plano." }] },
  { title: "PDV e caixa", items: [{ label: seniorItems.pdv, description: "Configure pontos de caixa sem limite numérico neste plano." }] },
  { title: "Atendimento", items: [{ label: seniorItems.waiterMode, description: "Sem limite numérico configurado para Modo Garçom neste plano." }] },
  { title: "Delivery", items: [{ label: seniorItems.deliverySystem, description: "Estruture as operações de entrega sem limite numérico neste plano." }] },
  { title: "Volume de pedidos", items: [{ label: seniorItems.monthlyOrders, description: "Sem limite mensal de pedidos configurado neste plano." }] },
  { title: "Cardápio e QR Code", items: [{ label: seniorItems.qrCodes, description: "Sem limite numérico de QR Codes configurado neste plano." }] },
  { title: "Impressoras", items: [{ label: seniorItems.printers, description: "Sem limite numérico de impressoras configurado neste plano." }] },
];

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

type PlanPricing = { monthly: number; annual: number };

function PlanPrice({ plan, billing }: { plan: PlanPricing; billing: Billing }) {
  const fullCents = Math.round(plan.monthly * 100) * 12;
  const annualCents = Math.round(plan.annual * 100);
  if (billing === "monthly") {
    return <>
      <div className="flex flex-wrap items-baseline gap-x-2"><strong className="font-display text-4xl font-bold text-foreground">{money.format(plan.monthly)}</strong><span className="text-sm text-muted-foreground">/mês</span></div>
      <p className="mt-1 text-sm font-medium text-foreground">ou {money.format(plan.annual)} / ano</p>
    </>;
  }
  const savings = (fullCents - annualCents) / 100;
  const monthlyEquivalent = annualCents % 12 === 0 ? plan.annual / 12 : null;
  return <>
    <span className="inline-block rounded bg-primary px-2.5 py-1 text-[10px] font-bold uppercase text-primary-foreground">Economize {money.format(savings)} no ano</span>
    <div className="mt-3 flex flex-wrap items-baseline gap-x-2"><strong className="font-display text-4xl font-bold text-foreground">{money.format(plan.annual)}</strong><span className="text-sm text-muted-foreground">/ano</span></div>
    <p className="mt-1 text-sm text-muted-foreground">De <s className="text-foreground/60">{money.format(fullCents / 100)}</s> por {money.format(plan.annual)} no ano</p>
    <p className="mt-0.5 text-xs text-muted-foreground">12 mensalidades de {money.format(plan.monthly)}{monthlyEquivalent != null && <> · equivale a {money.format(monthlyEquivalent)} por mês</>}</p>
  </>;
}

export function PricingSection() {
  const [billing, setBilling] = useState<Billing>("monthly");
  const [expanded, setExpanded] = useState<string[]>([]);
  const [showComparison, setShowComparison] = useState(false);

  function togglePlan(name: string) {
    setExpanded((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name]);
  }

  return <section id="planos" aria-labelledby="planos-title" className="scroll-mt-16 border-t border-border bg-background py-20 sm:py-28">
    <div className="mx-auto max-w-[1160px] px-5 sm:px-8">
      <div className="max-w-[730px]">
        <span className="text-xs font-bold uppercase tracking-widest text-primary">Planos para cada fase do seu negócio</span>
        <h2 id="planos-title" className="mt-3 font-display text-3xl font-bold leading-tight text-foreground sm:text-4xl">Um plano para o tamanho da sua operação.</h2>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">Do primeiro pedido ao gerenciamento de várias unidades, escolha a estrutura que acompanha o crescimento do seu negócio.</p>
      </div>

      <div className="mt-9 flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Período de contratação" className="inline-flex rounded-md border border-border bg-card p-1">
          {(["monthly", "annual"] as const).map((period) => <Button key={period} type="button" variant={billing === period ? "default" : "ghost"} aria-pressed={billing === period} onClick={() => setBilling(period)} className="min-w-24 shadow-none">{period === "monthly" ? "Mensal" : "Anual"}</Button>)}
        </div>
        <span className="text-xs text-muted-foreground">{billing === "monthly" ? "Valores mensais dos planos" : "Pague o ano com desconto — veja a economia em cada plano"}</span>
      </div>

      <div className="mt-9 grid gap-5 lg:grid-cols-3 lg:items-stretch lg:gap-6">
        {plans.map((plan) => {
          const isExpanded = expanded.includes(plan.name);
          if (plan.name === "Básico") return <article key={plan.name} className={`${plan.order} min-w-0 rounded-md border border-border bg-card p-6 sm:p-7`}>
            <h3 className="font-display text-2xl font-bold text-foreground">{plan.name}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{plan.description}</p>
            <p className="mt-5 text-xs font-semibold uppercase text-primary">{plan.profile}</p>
            <div className="mt-5 border-b border-border pb-5">
              <PlanPrice plan={basicPlan} billing={billing} />
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">Muito mais que um cardápio digital: tenha pedidos, atendimento, caixa e delivery conectados à sua operação.</p>
            </div>
            <Button variant="hero" size="hero" asChild className="mt-5 h-auto min-h-12 w-full whitespace-normal py-3 text-center transition-transform duration-200 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring"><a href={checkoutLinks.Básico[billing]} aria-label={`Assinar plano Básico no ciclo ${billing === "monthly" ? "mensal" : "anual"}`}>Começar agora <ArrowRight aria-hidden="true" /></a></Button>
            <div className="mt-6 border-t border-border pt-5">
              <h4 className="font-display text-base font-semibold text-foreground">Tudo para começar com mais controle</h4>
              <ul className="mt-4 space-y-3">{basicHighlights.map((item) => <li key={item} className="flex items-start gap-2 text-sm leading-snug text-foreground"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />{item}</li>)}</ul>
            </div>
            <Button type="button" variant="ghost" className="mt-5 h-auto min-h-10 w-full whitespace-normal text-center text-primary" aria-expanded={isExpanded} aria-controls="plan-details-Básico" onClick={() => togglePlan(plan.name)}>{isExpanded ? "Mostrar menos" : "Ver tudo que está incluso"}<ChevronDown aria-hidden="true" className={`transition-transform ${isExpanded ? "rotate-180" : ""}`} /></Button>
            <div id="plan-details-Básico" className={`grid transition-[grid-template-rows,opacity] duration-300 motion-reduce:transition-none ${isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`} aria-hidden={!isExpanded}>
              <div className="overflow-hidden"><div className="mt-5 space-y-6 border-t border-border pt-5">{basicGroups.map((group) => <div key={group.title}>
                <h5 className="text-xs font-bold uppercase text-primary">{group.title}</h5>
                <ul className="mt-3 space-y-3">{group.items.map((item) => <li key={item.label} className="flex items-start gap-2 text-sm"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" /><div><strong className="font-medium text-foreground">{item.label}</strong><p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{item.description}</p></div></li>)}</ul>
              </div>)}</div></div>
            </div>
          </article>;
          if (plan.name === "Profissional") return <article key={plan.name} className={`${plan.order} relative min-w-0 rounded-md border border-primary bg-surface-warm p-6 shadow-[var(--shadow-float)] sm:p-7 lg:-translate-y-2`}>
            <span className="mb-5 inline-block rounded bg-primary px-2.5 py-1 text-[10px] font-bold uppercase text-primary-foreground">Mais Popular</span>
            <h3 className="font-display text-2xl font-bold text-foreground">Profissional</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Para estabelecimentos com maior movimento que precisam integrar atendimento, caixa, cozinha, estoque, equipe e delivery em uma única operação.</p>
            <p className="mt-5 text-xs font-semibold uppercase text-primary">Ideal para negócios em crescimento</p>
            <div className="mt-5 border-b border-border pb-5">
              <PlanPrice plan={professionalPlan} billing={billing} />
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">Mais estrutura para sua operação crescer sem perder o controle do atendimento, equipe e pedidos.</p>
            </div>
            <Button variant="hero" size="hero" asChild className="mt-5 h-auto min-h-12 w-full whitespace-normal py-3 text-center transition-transform duration-200 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring"><a href={checkoutLinks.Profissional[billing]} aria-label={`Assinar plano Profissional no ciclo ${billing === "monthly" ? "mensal" : "anual"}`}>Quero profissionalizar minha operação <ArrowRight aria-hidden="true" /></a></Button>
            <div className="mt-6 border-t border-border pt-5">
              <h4 className="font-display text-base font-semibold text-foreground">Uma operação mais completa em um só sistema</h4>
              <ul className="mt-4 space-y-3">{professionalHighlights.map((item) => <li key={item} className="flex items-start gap-2 text-sm leading-snug text-foreground"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />{item}</li>)}</ul>
            </div>
            <Button type="button" variant="ghost" className="mt-5 h-auto min-h-10 w-full whitespace-normal text-center text-primary" aria-expanded={isExpanded} aria-controls="plan-details-Profissional" onClick={() => togglePlan(plan.name)}>{isExpanded ? "Mostrar menos" : "Ver tudo que está incluso"}<ChevronDown aria-hidden="true" className={`transition-transform ${isExpanded ? "rotate-180" : ""}`} /></Button>
            <div id="plan-details-Profissional" className={`grid transition-[grid-template-rows,opacity] duration-300 motion-reduce:transition-none ${isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`} aria-hidden={!isExpanded}>
              <div className="overflow-hidden"><div className="mt-5 space-y-6 border-t border-border pt-5">{professionalGroups.map((group) => <div key={group.title}>
                <h5 className="text-xs font-bold uppercase text-primary">{group.title}</h5>
                {"description" in group && group.description && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{group.description}</p>}
                <ul className="mt-3 space-y-3">{group.items.map((item) => <li key={item.label} className="flex items-start gap-2 text-sm"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" /><div><strong className="font-medium text-foreground">{item.label}</strong>{"description" in item && item.description && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{item.description}</p>}</div></li>)}</ul>
              </div>)}
                <div className="border-t border-border pt-5"><p className="font-display text-sm font-semibold text-foreground">Do pedido à entrega, tudo conectado.</p><p className="mt-2 text-xs leading-relaxed text-muted-foreground">Atendimento → PDV → Cozinha → Estoque → Delivery</p></div>
              </div></div>
            </div>
          </article>;
          return <article key={plan.name} className={`${plan.order} min-w-0 rounded-md border border-border bg-card p-6 sm:p-7`}>
            <span className="mb-5 inline-block rounded border border-primary px-2.5 py-1 text-[10px] font-bold uppercase text-primary">Maior liberdade</span>
            <h3 className="font-display text-2xl font-bold text-foreground">{plan.name}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{plan.description}</p>
            <p className="mt-5 text-xs font-semibold uppercase text-primary">{plan.profile}</p>
            <div className="mt-5 border-b border-border pb-5">
              <PlanPrice plan={seniorPlan} billing={billing} />
              <p className="mt-4 text-sm font-semibold text-foreground">Sua operação cresce. O sistema acompanha.</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Centralize sua operação sem se preocupar com limites de estabelecimentos, produtos, equipe, PDVs, pedidos ou QR Codes.</p>
            </div>
            <Button variant="heroOutline" size="hero" asChild className="mt-5 h-auto min-h-12 w-full whitespace-normal py-3 text-center leading-snug transition-transform duration-200 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring"><a href={checkoutLinks["Profissional Sênior"][billing]} aria-label={`Assinar plano Profissional Sênior no ciclo ${billing === "monthly" ? "mensal" : "anual"}`}>{plan.primary} <ArrowRight aria-hidden="true" /></a></Button>
            <div className="mt-6 border-t border-border pt-5">
              <h4 className="font-display text-base font-semibold text-foreground">Cresça sem esbarrar nos limites dos planos anteriores</h4>
              <ul className="mt-4 space-y-3">{seniorHighlights.map((item) => <li key={item} className="flex items-start gap-2 text-sm leading-snug text-foreground"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" /><span>{item}</span></li>)}</ul>
            </div>
            <Button type="button" variant="ghost" className="mt-5 h-auto min-h-10 w-full whitespace-normal text-center text-primary" aria-expanded={isExpanded} aria-controls="plan-details-Profissional-Sênior" onClick={() => togglePlan(plan.name)}>{isExpanded ? "Mostrar menos" : "Ver tudo que está incluso"}<ChevronDown aria-hidden="true" className={`transition-transform ${isExpanded ? "rotate-180" : ""}`} /></Button>
            <div id="plan-details-Profissional-Sênior" className={`grid transition-[grid-template-rows,opacity] duration-300 motion-reduce:transition-none ${isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`} aria-hidden={!isExpanded}>
              <div className="overflow-hidden"><div className="mt-5 space-y-6 border-t border-border pt-5">{seniorGroups.map((group) => <div key={group.title}>
                <h5 className="text-xs font-bold uppercase text-primary">{group.title}</h5>
                <ul className="mt-3 space-y-3">{group.items.map((item) => <li key={item.label} className="flex items-start gap-2 text-sm"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" /><div><strong className="font-medium text-foreground">{item.label}</strong><p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{item.description}</p></div></li>)}</ul>
              </div>)}
                <div className="border-t border-border pt-5"><p className="font-display text-sm font-semibold text-foreground">Mais liberdade para administrar. Menos preocupação com limites.</p><p className="mt-2 text-xs leading-relaxed text-muted-foreground">O Profissional Sênior foi pensado para operações que precisam ampliar estrutura, equipe e volume sem migrar de plano cada vez que o negócio cresce.</p></div>
              </div></div>
            </div>
          </article>;
        })}
      </div>

      <div className="mt-8 flex flex-col items-center gap-3 text-center"><SaasAccessButton access="signup" size="hero" className="font-bold" /></div>
      <p className="mt-5 text-center text-xs leading-relaxed text-muted-foreground">Valores e limites informados para esta apresentação. Condições de contratação e módulos do Profissional Sênior devem ser confirmados com a equipe MasterApp.</p>
      <div className="mt-8 text-center"><Button type="button" variant="link" aria-expanded={showComparison} aria-controls="plan-comparison" onClick={() => setShowComparison((current) => !current)} className="h-auto whitespace-normal text-sm">{showComparison ? "Ocultar comparação" : "Comparar todos os recursos dos planos"}<ChevronDown aria-hidden="true" className={`transition-transform ${showComparison ? "rotate-180" : ""}`} /></Button></div>
      {showComparison && <div id="plan-comparison" className="mt-6 border-t border-border pt-6">
        <h3 className="font-display text-xl font-semibold">Compare os perfis</h3>
        <p className="mt-2 text-sm text-muted-foreground">Os valores e limites foram informados para esta apresentação; confirme as condições comerciais com a equipe MasterApp.</p>
        <div className="mt-5 grid gap-4 md:grid-cols-3">{plans.map((plan) => <div key={plan.name} className="rounded-md border border-border bg-card p-5"><h4 className="font-display text-lg font-bold">{plan.name}</h4><p className="mt-2 text-sm text-muted-foreground">{plan.profile}</p><p className="mt-4 text-sm">{plan.focus}</p><p className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground">{plan.name === "Básico" ? `${money.format(basicPlan.monthly)}/mês ou ${money.format(basicPlan.annual)}/ano · até ${basicLimits.monthlyOrders} pedidos/mês` : plan.name === "Profissional" ? `${money.format(professionalPlan.monthly)}/mês ou ${money.format(professionalPlan.annual)}/ano · até ${professionalLimits.monthlyOrders.toLocaleString("pt-BR")} pedidos/mês` : `${money.format(seniorPlan.monthly)}/mês ou ${money.format(seniorPlan.annual)}/ano · ${seniorItems.monthlyOrders.toLowerCase()} · ${seniorItems.printers.toLowerCase()}`}</p></div>)}</div>
      </div>}
      <div className="mt-9 flex flex-wrap justify-center gap-x-7 gap-y-3 border-t border-border pt-7 text-xs text-muted-foreground"><span className="inline-flex items-center gap-2"><Check aria-hidden="true" className="size-4 text-success" />Pensado para estabelecimentos gastronômicos</span><span className="inline-flex items-center gap-2"><Check aria-hidden="true" className="size-4 text-success" />Da operação menor às múltiplas unidades</span></div>
    </div>
  </section>;
}