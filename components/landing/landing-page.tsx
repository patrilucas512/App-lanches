"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BellRing, Check, ChevronDown, CircleCheck, ClipboardList, LayoutDashboard, Menu, PackageCheck, Printer, ShoppingBag, Timer, Truck, UtensilsCrossed, X, Users, Boxes, ChartNoAxesCombined, Palette, ShieldCheck, QrCode, Smartphone, Table2 } from "lucide-react";
import { Button } from "./button";
import { PricingSection } from "./pricing-section";
import GlyphPortal from "./glyph-portal";
import { SaasAccessButton } from "./saas-access-button";
const coffee = "/images/coffee-cutout.png";
const acai = "/images/acai-cutout.png";
const sushi = "/images/sushi-cutout.png";
const cake = "/images/cake-cutout.png";
const burger = "/images/burger-cutout.png";
const pizza = "/images/pizza-cutout.png";
const dashboardImage = "/images/masterapp-dashboard-filled.jpg";
const menuImage = "/images/masterapp-menu.jpg";
const brandSymbol = "/images/masterapp-symbol.png";
const qrRestaurantMenu = "/images/qr-restaurant-original-menu.jpg";
const acaiOperation = "/images/acai-operacao.webp";
const mariahLanches = "/images/mariah-lanches.webp";
const villa27 = "/images/villa-27.webp";
const saborDaCasa = "/images/sabor-da-casa.webp";
const brasaNobreSales = "/images/brasa-nobre-vendas.webp";

const nav = [
  { label: "Recursos", href: "#recursos" },
  { label: "Como funciona", href: "#como-funciona" },
  { label: "Visão do sistema", href: "#sistema" },
  { label: "Planos", href: "#planos" },
];

const benefits = [
  { icon: ShoppingBag, title: "Pedidos organizados", description: "Visualize o que chegou, o que está em preparo e o que já saiu para entrega." },
  { icon: LayoutDashboard, title: "Tudo em uma tela", description: "Uma visão mais clara da rotina, sem perder tempo procurando informações." },
  { icon: Truck, title: "Entregas acompanhadas", description: "Tenha os status de saída e entrega à vista para cuidar de cada pedido." },
];

const steps = [
  { number: "01", icon: ClipboardList, title: "Receba", description: "Confira os novos pedidos e os detalhes de cada venda em um só lugar." },
  { number: "02", icon: PackageCheck, title: "Prepare", description: "Acompanhe a fila e mantenha a equipe alinhada sobre o que vem a seguir." },
  { number: "03", icon: Truck, title: "Entregue", description: "Visualize o andamento das saídas até a conclusão do pedido." },
];

const operationResources = [
  { icon: Table2, title: "Mesas e comandas sem confusão", description: "Organize o atendimento do primeiro pedido ao fechamento. Divisão de conta e transferência de itens para acompanhar o ritmo do salão." },
  { icon: UtensilsCrossed, title: "Cozinha alinhada, pedidos no ritmo", description: "Reúna a produção no KDS, com estações, tempos de preparo e alertas sonoros. Mais clareza para saber o que preparar a seguir." },
  { icon: Smartphone, title: "Seu cardápio na mão do cliente", description: "Transforme o QR Code em um convite para pedir. Apresente produtos, categorias e adicionais com a identidade do seu estabelecimento." },
  { icon: QrCode, title: "PIX para simplificar a cobrança", description: "Uma experiência de pagamento mais prática para o cliente e mais organização para acompanhar as cobranças da sua operação." },
  { icon: Truck, title: "Delivery sob seu controle", description: "Do despacho à entrega, mantenha pedidos e entregadores alinhados. Seu atendimento continua mesmo quando o cliente está em casa." },
  { icon: Printer, title: "Impressão que acompanha o pedido", description: "Leve comandas e adicionais à impressão térmica. Informações claras para a equipe preparar cada pedido com mais atenção." },
  { icon: Users, title: "Equipe conectada à operação", description: "Organize funcionários e acessos conforme cada função. Atendimento, caixa e cozinha com foco no que precisam fazer." },
  { icon: Boxes, title: "Produtos e estoque em ordem", description: "Reúna produtos, itens, receitas e movimentações. Mais organização nos bastidores para apoiar o que acontece no balcão." },
  { icon: ChartNoAxesCombined, title: "Mais clareza para decidir", description: "Acompanhe o faturamento e o movimento dos pedidos. Uma visão organizada para planejar os próximos passos do seu negócio." },
  { icon: BellRing, title: "Atenção ao que importa agora", description: "Alertas de pedidos e da cozinha ajudam sua equipe a identificar prioridades e manter o fluxo do atendimento." },
  { icon: Palette, title: "Sua marca em cada escolha", description: "Valorize a identidade do seu estabelecimento no cardápio digital. Uma apresentação mais profissional, do primeiro acesso ao pedido." },
  { icon: ShieldCheck, title: "Cada função no seu lugar", description: "Controle de acesso para organizar quem utiliza cada área do sistema. Mais cuidado com as informações e responsabilidades da equipe." },
];

const faqs = [
  { question: "Para quem é o masterApp?", answer: "Esta página apresenta o masterApp para negócios que trabalham com delivery e querem organizar melhor seus pedidos e entregas." },
  { question: "Posso usar no celular?", answer: "A experiência apresentada foi pensada para visualizar a operação em diferentes tamanhos de tela. Os recursos definitivos do sistema podem ser apresentados em uma demonstração." },
  { question: "Como conheço os recursos disponíveis?", answer: "A seção de visão do sistema mostra um exemplo ilustrativo. Para confirmar recursos, planos e disponibilidade, entre em contato com a equipe do masterApp." },
];

function Logo() {
  return <a href="#inicio" aria-label="masterApp, voltar ao início" className="inline-flex items-center gap-2.5 font-display text-xl font-bold text-inherit">
    <img src={brandSymbol} alt="" className="h-9 w-10 object-contain" width={40} height={36} />
    <span>Master<span className="text-primary">App</span></span>
  </a>;
}

function DashboardPreview() {
  return <div className="relative mx-auto w-full max-w-[610px] pb-14 pr-8 sm:pb-20 sm:pr-12" aria-label="Imagens de demonstração do MasterApp no notebook e no celular">
    <div className="device-shadow overflow-hidden rounded-t-lg border-[5px] border-preview bg-preview sm:border-[7px]">
      <img src={dashboardImage} alt="Painel MasterApp em um notebook, com visão geral da operação" className="block w-full" width={1376} height={768} />
    </div>
    <div className="mx-auto h-2 w-[104%] -translate-x-[2%] rounded-b-lg border border-border bg-muted shadow-sm sm:h-3" />
    <div className="phone-motion device-shadow absolute bottom-0 right-0 z-10 w-[26%] overflow-hidden rounded-[15px] border-[4px] border-preview bg-preview sm:rounded-[24px] sm:border-[6px]">
      <img src={menuImage} alt="Cardápio MasterApp em um celular, com o logotipo e hambúrgueres" className="block w-full" width={768} height={1285} />
    </div>
  </div>;
}

const galleryImages = [
  { src: mariahLanches, alt: "Cliente consultando o cardápio Mariah El Lanches em uma lanchonete" },
  { src: acaiOperation, alt: "Loja de açaí com pedidos na cozinha e cardápio digital" },
  { src: villa27, alt: "Atendimento em pub com telas de pedidos" },
  { src: saborDaCasa, alt: "Atendente entregando pedido ao motoboy no restaurante" },
  { src: brasaNobreSales, alt: "Restaurante com painel MasterApp em primeiro plano" },
];

function ScreensGallery() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const dragStart = useRef<number | null>(null);

  useEffect(() => {
    if (paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setActive((index) => (index + 1) % galleryImages.length), 5000);
    return () => window.clearInterval(timer);
  }, [paused]);

  function finishDrag(x: number) {
    const start = dragStart.current;
    if (start !== null && Math.abs(x - start) > 50) {
      setActive((index) => (index + (x < start ? 1 : galleryImages.length - 1)) % galleryImages.length);
    }
    dragStart.current = null;
  }

  return <GlyphPortal word="MASTERAPP" scrollLength={1.5} fontFamily='"Outfit", Arial, sans-serif' fontWeight={800} className="masterapp-portal" enterLabel="Explorar telas" front={<div className="masterapp-portal-intro"><span className="text-xs font-bold uppercase tracking-widest text-primary">Por dentro do MasterApp</span><p className="mt-3 font-display text-xl font-semibold text-foreground sm:text-2xl">Explore as telas</p></div>} background={<div className="masterapp-portal-scene" aria-hidden="true"><img src={dashboardImage} alt="" className="masterapp-portal-dashboard" /><img src={menuImage} alt="" className="masterapp-portal-phone" /></div>}>
    <div className="mx-auto w-full max-w-[1120px] px-5 sm:px-8">
      <span className="text-xs font-bold uppercase tracking-widest text-primary-foreground/80">Por dentro do MasterApp</span>
      <h2 className="mt-3 max-w-[780px] font-display text-3xl font-bold leading-tight text-primary-foreground sm:text-4xl">Estabelecimentos já estão operando com o MasterApp. Agora é a vez do seu.</h2>
      <div className="mx-auto mt-10 max-w-[880px]" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}>
        <div className="relative overflow-hidden rounded-md border border-preview-line bg-preview" onPointerDown={(event) => { dragStart.current = event.clientX; }} onPointerUp={(event) => finishDrag(event.clientX)} onPointerCancel={() => { dragStart.current = null; }}>
          <div className="flex touch-pan-y transition-transform duration-500 ease-out motion-reduce:transition-none" style={{ transform: `translateX(-${active * 100}%)` }}>
            {galleryImages.map((image) => <div key={image.src} className="flex aspect-[16/9] w-full shrink-0 items-center justify-center">
              <img src={image.src} alt={image.alt} className="h-full w-full object-contain" draggable={false} loading="lazy" />
            </div>)}
          </div>
          <div className="pointer-events-none absolute inset-x-2 top-1/2 flex -translate-y-1/2 justify-between sm:inset-x-3">
            <Button variant="ghost" size="icon" className="pointer-events-auto size-9 border border-preview-foreground/30 bg-preview/55 text-preview-foreground backdrop-blur-sm hover:bg-preview/85 hover:text-preview-foreground sm:size-10" aria-label="Imagem anterior" title="Imagem anterior" onClick={() => setActive((index) => (index + galleryImages.length - 1) % galleryImages.length)}><ArrowLeft /></Button>
            <Button variant="ghost" size="icon" className="pointer-events-auto size-9 border border-preview-foreground/30 bg-preview/55 text-preview-foreground backdrop-blur-sm hover:bg-preview/85 hover:text-preview-foreground sm:size-10" aria-label="Próxima imagem" title="Próxima imagem" onClick={() => setActive((index) => (index + 1) % galleryImages.length)}><ArrowRight /></Button>
          </div>
        </div>
        <span className="sr-only" aria-live="polite">Imagem {active + 1} de {galleryImages.length}</span>
      </div>
    </div>
  </GlyphPortal>;
}

export function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  return <div className="min-h-screen overflow-hidden bg-background">
    <div className="hero-wash relative min-h-[760px] overflow-hidden lg:min-h-[700px]" id="inicio">
      <header className="relative z-30 border-b border-border bg-background text-foreground">
        <div className="mx-auto flex min-h-[76px] max-w-[1280px] flex-wrap items-center justify-between gap-x-5 gap-y-3 px-5 py-4 sm:flex-nowrap sm:px-8">
          <Logo />
          <nav className="hidden items-center gap-6 xl:flex" aria-label="Navegação principal">{[...nav, { label: "FAQ", href: "#duvidas" }].map((link) => <a key={link.href} href={link.href} className="whitespace-nowrap text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">{link.label}</a>)}</nav>
          <div className="order-3 flex w-full shrink-0 items-center gap-2 sm:order-none sm:ml-auto sm:w-auto xl:ml-0"><SaasAccessButton access="login" size="lg" variant="outline" className="flex-1 border-border bg-transparent px-4 font-bold text-foreground hover:bg-secondary hover:text-foreground disabled:opacity-100 sm:flex-none" /><SaasAccessButton access="signup" label="15 dias de teste grátis" size="lg" className="flex-1 px-4 font-bold shadow-none disabled:opacity-100 sm:flex-none" /></div>
          <Button className="text-foreground hover:bg-secondary hover:text-foreground xl:hidden" variant="ghost" size="icon" aria-label={menuOpen ? "Fechar menu" : "Abrir menu"} aria-expanded={menuOpen} aria-controls="mobile-navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</Button>
        </div>
        {menuOpen && <nav id="mobile-navigation" className="absolute inset-x-0 top-full z-40 flex flex-col border-b border-border bg-background px-5 py-3 shadow-lg xl:hidden" aria-label="Navegação móvel">{[...nav, { label: "Dúvidas", href: "#duvidas" }].map((link) => <a onClick={() => setMenuOpen(false)} key={link.label} href={link.href} className="rounded px-3 py-3 text-sm font-medium text-foreground hover:bg-secondary">{link.label}</a>)}</nav>}
      </header>
      <div className="relative z-10 mx-auto grid max-w-[1160px] items-center gap-8 px-5 pb-12 pt-14 sm:px-8 sm:pt-16 lg:grid-cols-[0.93fr_1.07fr] lg:gap-8 lg:pb-20 lg:pt-24">
        <div className="max-w-[570px]">
          <div className="mb-5 flex flex-wrap items-center gap-2"><span className="rounded bg-primary px-2.5 py-1 text-[10px] font-bold uppercase text-primary-foreground">Para toda culinária</span><span className="rounded bg-success px-2.5 py-1 text-[10px] font-bold uppercase text-primary-foreground">Mais controle</span></div>
          <h1 className="font-display text-[clamp(2.7rem,4.3vw,4.25rem)] font-bold leading-[1.07] text-foreground">Seu movimento aumentou? Sua operação precisa <span className="brand-gradient-text">acompanhar.</span></h1>
          <div className="mt-6 max-w-[520px] space-y-3 text-base leading-relaxed text-muted-foreground sm:text-lg">
            <p>O MasterApp não é apenas um cardápio digital. É um sistema completo para organizar pedidos, agilizar o atendimento e dar mais controle ao seu estabelecimento — principalmente quando a casa está cheia.</p>
            <p className="font-semibold text-foreground">Mais agilidade para sua equipe. Mais organização para você. Mais profissionalismo para o seu negócio.</p>
          </div>
          <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><CircleCheck className="size-3.5 text-success" /> Pedidos à vista</span><span className="flex items-center gap-1.5"><CircleCheck className="size-3.5 text-success" /> Operação organizada</span><span className="flex items-center gap-1.5"><CircleCheck className="size-3.5 text-success" /> Entregas acompanhadas</span></div>
        </div>
        <div className="relative isolate mt-6 px-5 pb-14 pt-16 sm:mx-auto sm:w-full sm:max-w-[680px] sm:px-10 sm:pb-20 sm:pt-20 lg:mt-0 lg:px-4 lg:pb-16 lg:pt-16">
          <div className="food-perimeter pointer-events-none absolute inset-0 z-0" aria-hidden="true">
            <img className="food-float food-delay-1 pointer-events-auto absolute left-[3%] top-0 w-16 sm:w-20 lg:w-20" src={coffee} alt="" width={768} height={768} />
            <img className="food-float food-delay-2 pointer-events-auto absolute right-[2%] top-0 w-20 sm:w-24 lg:w-24" src={sushi} alt="" width={768} height={768} />
            <img className="food-float food-delay-2 pointer-events-auto absolute left-0 top-[49%] w-16 sm:w-20 lg:w-20" src={burger} alt="" width={768} height={768} />
            <img className="food-float food-delay-1 pointer-events-auto absolute right-0 top-[53%] w-16 sm:w-20 lg:w-20" src={pizza} alt="" width={768} height={768} />
            <img className="food-float food-delay-3 pointer-events-auto absolute bottom-0 left-[7%] w-16 sm:w-20 lg:w-20" src={acai} alt="" width={768} height={768} />
            <img className="food-float food-delay-4 pointer-events-auto absolute bottom-0 right-[9%] w-16 sm:w-20 lg:w-20" src={cake} alt="" width={768} height={768} />
          </div>
          <div className="relative z-10"><DashboardPreview /><p className="mt-3 text-center text-xs text-muted-foreground">Prévia ilustrativa; os valores não representam dados reais.</p></div>
        </div>
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-px bg-border" />
    </div>

    <section aria-label="Culinárias e operação" className="border-b border-border bg-card py-9 sm:py-11">
      <div className="mx-auto grid max-w-[1120px] grid-cols-2 gap-x-6 gap-y-9 px-5 text-center sm:px-8 lg:grid-cols-4 lg:gap-8">
        {[
          { highlight: "Café & doces", label: "DA MANHÃ À SOBREMESA", description: "Um espaço para cada momento do seu cardápio." },
          { highlight: "Lanches & pizza", label: "SABORES DO DIA A DIA", description: "Pedidos organizados para acompanhar o movimento." },
          { highlight: "Açaí", label: "OPÇÕES PARA TODOS", description: "Mais clareza para cuidar de cada pedido." },
          { highlight: "Comida japonesa", label: "TODA LINHA CULINÁRIA", description: "Do preparo à entrega, tudo à vista." },
        ].map(({ highlight, label, description }) => <div key={highlight} className="min-w-0">
          <h2 className="font-display text-2xl font-bold leading-tight text-foreground sm:text-[1.75rem]">{highlight}</h2>
          <p className="mt-1 text-[10px] font-bold uppercase text-foreground sm:text-xs">{label}</p>
          <p className="mx-auto mt-1 max-w-[190px] text-xs leading-snug text-muted-foreground">{description}</p>
        </div>)}
      </div>
    </section>

    <section id="recursos" className="scroll-mt-16 bg-card py-20 sm:py-28"><div className="mx-auto max-w-[1120px] px-5 sm:px-8"><div className="max-w-2xl"><span className="text-xs font-bold uppercase tracking-widest text-primary">Tudo mais claro</span><h2 className="mt-3 font-display text-3xl font-bold leading-tight sm:text-4xl">Uma rotina mais leve começa com a operação organizada.</h2><p className="mt-4 text-muted-foreground">O masterApp reúne o que importa para você acompanhar o fluxo do delivery.</p></div><div className="mt-12 grid gap-8 md:grid-cols-3">{benefits.map(({ icon: Icon, title, description }) => <div key={title} className="border-t border-border pt-6"><span className="grid size-11 place-items-center rounded-md bg-brand-soft text-primary"><Icon className="size-5" /></span><h3 className="mt-5 font-display text-xl font-semibold">{title}</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p></div>)}</div></div></section>

    <section id="salao-cozinha" className="border-t border-border bg-surface-warm py-20 sm:py-28" aria-labelledby="salao-cozinha-title">
      <div className="mx-auto max-w-[1120px] px-5 sm:px-8">
        <div className="mx-auto max-w-[720px] text-center">
          <span className="text-xs font-bold uppercase tracking-widest text-primary">Módulos</span>
          <h2 id="salao-cozinha-title" className="mt-3 font-display text-3xl font-bold leading-tight text-foreground sm:text-4xl">Seu estabelecimento com mais rapidez no atendimento.</h2>
          <p className="mt-4 leading-relaxed text-muted-foreground">Do garçom à cozinha, da cozinha direto à mesa. Cada tela foi desenhada para acelerar o giro, reduzir erros e deixar o cliente satisfeito.</p>
        </div>
        <div className="mt-14 grid items-center gap-12 lg:mt-20 lg:grid-cols-[1fr_1fr] lg:gap-16">
          <div className="max-w-[510px]">
            <span className="text-xs font-bold uppercase tracking-widest text-primary">Salão &amp; cozinha</span>
            <h3 className="mt-3 font-display text-2xl font-bold leading-tight text-foreground sm:text-3xl">Mesas, comandas e KDS em perfeita sincronia.</h3>
            <p className="mt-5 leading-relaxed text-muted-foreground">O garçom lança o pedido no próprio celular ou no aparelho do estabelecimento. A cozinha recebe no KDS, com tempo de preparo definido pelo administrador, e o cliente acompanha o status. Sem papel, bloco ou caneta: tudo com um clique.</p>
            <ul className="mt-7 space-y-4 text-sm text-foreground">
              <li className="flex items-start gap-3"><span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-brand-soft text-primary"><Check className="size-3" /></span>Divisão de conta e transferência de itens</li>
              <li className="flex items-start gap-3"><span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-brand-soft text-primary"><Check className="size-3" /></span>Estações de cozinha e alertas sonoros</li>
              <li className="flex items-start gap-3"><span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-brand-soft text-primary"><Check className="size-3" /></span>Impressão térmica automática com adicionais</li>
            </ul>
          </div>
          <figure className="min-w-0">
            <div className="float-shadow overflow-hidden rounded-md border border-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-4 sm:px-6">
                <div className="flex items-center gap-2.5"><span className="grid size-9 place-items-center rounded-md bg-brand-soft text-primary"><UtensilsCrossed className="size-4" /></span><div><p className="font-display text-sm font-bold text-foreground">MasterApp · KDS</p><p className="text-xs text-muted-foreground">Estação da cozinha</p></div></div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-xs font-semibold text-success"><span className="size-1.5 rounded-full bg-success" /> Em operação</span>
              </div>
              <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
                {[
                  { name: "Mesa 03", state: "Em preparo", icon: Timer, detail: "Comanda enviada à cozinha", active: true },
                  { name: "Mesa 07", state: "Novo pedido", icon: BellRing, detail: "Pedido recebido", active: false },
                  { name: "Delivery", state: "Em preparo", icon: Timer, detail: "Produção em andamento", active: true },
                  { name: "Balcão", state: "Pronto", icon: Check, detail: "Aguardando atendimento", active: false },
                ].map(({ name, state, icon: Icon, detail, active }) => <div key={name} className={`min-w-0 rounded-md border bg-background p-3.5 sm:p-4 ${active ? "border-primary/50" : "border-border"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2"><strong className="font-display text-sm text-foreground">{name}</strong><span className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold ${active ? "bg-brand-soft text-primary" : "bg-muted text-muted-foreground"}`}><Icon className="size-3" />{state}</span></div>
                  <p className="mt-5 text-xs text-muted-foreground">{detail}</p>
                  <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${active ? "w-2/3 bg-primary" : "w-1/3 bg-success"}`} /></div>
                </div>)}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-5"><span className="inline-flex items-center gap-1.5"><Timer className="size-3.5 text-primary" /> Tempo de preparo definido pelo administrador</span><Printer className="size-4 text-primary" aria-hidden="true" /></div>
            </div>
            <figcaption className="mt-3 text-center text-xs text-muted-foreground">Visualização ilustrativa do fluxo de comandas.</figcaption>
          </figure>
        </div>
      </div>
    </section>

    <section id="cardapio-digital" className="border-y border-border bg-background py-20 sm:py-28" aria-labelledby="cardapio-title">
      <div className="mx-auto grid max-w-[1200px] items-start gap-x-14 gap-y-9 px-5 sm:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:grid-rows-[auto_1fr] lg:gap-y-0">
        <div className="order-1 lg:col-start-2 lg:row-start-1 lg:pt-8">
          <span className="text-xs font-bold uppercase tracking-widest text-primary">Cardápio digital</span>
          <h2 id="cardapio-title" className="mt-4 max-w-[530px] font-display text-3xl font-bold leading-tight text-foreground sm:text-4xl">Seu cliente senta, escaneia e já pode pedir.</h2>
          <p className="mt-5 max-w-[490px] leading-relaxed text-muted-foreground">Um simples QR Code na mesa abre o cardápio do seu estabelecimento direto no celular do cliente. Sem aplicativo para baixar e sem complicação para começar o pedido.</p>
          <span className="mt-6 inline-flex items-center gap-2 rounded border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground"><CircleCheck className="size-4 text-success" /> Sem precisar instalar aplicativo</span>
        </div>
        <figure className="order-2 min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <img src={qrRestaurantMenu} alt="Cliente em uma hamburgueria consultando o cardápio original Mariah El Lanches no celular, ao lado de um suporte com QR Code" width={1536} height={1024} loading="lazy" className="aspect-[3/2] w-full rounded-md object-cover" />
          <figcaption className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold uppercase text-muted-foreground sm:text-xs"><span>1. Escaneia</span><ArrowRight className="size-3 text-primary" aria-hidden="true" /><span>2. Escolhe</span><ArrowRight className="size-3 text-primary" aria-hidden="true" /><span>3. Pede</span></figcaption>
        </figure>
        <div className="order-3 lg:col-start-2 lg:row-start-2 lg:pt-8">
          <ul className="space-y-5">
            <li className="flex items-start gap-3"><span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-success-soft text-success"><Check className="size-3.5" /></span><div><h3 className="font-display font-semibold">QR Code direto na mesa</h3><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Cliente acessa o cardápio pelo próprio celular.</p></div></li>
            <li className="flex items-start gap-3"><span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-success-soft text-success"><Check className="size-3.5" /></span><div><h3 className="font-display font-semibold">Seu cardápio, sua marca</h3><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Produtos, categorias, preços e identidade do estabelecimento.</p></div></li>
            <li className="flex items-start gap-3"><span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-success-soft text-success"><Check className="size-3.5" /></span><div><h3 className="font-display font-semibold">Pedido conectado à operação</h3><p className="mt-1 text-sm leading-relaxed text-muted-foreground">O pedido pode seguir organizado para atendimento e produção dentro do sistema.</p></div></li>
          </ul>
          <Button variant="hero" size="hero" asChild className="mt-8"><a href="#sistema">Conhecer o masterApp <ArrowRight /></a></Button>
        </div>
      </div>
    </section>

    <section id="como-funciona" className="scroll-mt-16 bg-surface-warm py-20 sm:py-28"><div className="mx-auto max-w-[1120px] px-5 sm:px-8"><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><span className="text-xs font-bold uppercase tracking-widest text-primary">Do primeiro toque à entrega</span><h2 className="mt-3 max-w-lg font-display text-3xl font-bold leading-tight sm:text-4xl">Um fluxo que acompanha o seu ritmo.</h2></div><p className="max-w-sm text-sm leading-relaxed text-muted-foreground">Acompanhe cada etapa sem perder de vista o que precisa de atenção agora.</p></div><div className="mt-12 grid gap-4 md:grid-cols-3">{steps.map(({ number, icon: Icon, title, description }) => <div key={number} className="rounded-md border border-border bg-card p-6 sm:p-8"><div className="flex items-center justify-between"><span className="font-display text-4xl font-bold text-accent">{number}</span><Icon className="size-6 text-primary" /></div><h3 className="mt-9 font-display text-xl font-semibold">{title}</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p></div>)}</div></div></section>

    <section aria-label="MasterApp em números" className="border-b border-border bg-card py-10 sm:py-14">
      <div className="mx-auto grid max-w-[1120px] grid-cols-2 gap-x-5 gap-y-10 px-5 text-center sm:px-8 lg:grid-cols-4 lg:gap-8">
        {[
          { value: "+500", label: "ESTABELECIMENTOS", description: "Restaurantes, bares e delivery em operação." },
          { value: "24/7", label: "OPERAÇÃO ESTÁVEL", description: "Infraestrutura na nuvem com monitoramento contínuo." },
          { value: "0%", label: "TAXA POR PEDIDO", description: "Mensalidade fixa. Sem comissão em vendas." },
          { value: "5.0", label: "AVALIAÇÃO MÉDIA", description: "Nota reportada por clientes ativos no suporte.", star: true },
        ].map(({ value, label, description, star }) => <div key={label} className="min-w-0">
          <div className="flex items-baseline justify-center gap-1"><strong className="font-display text-3xl font-bold leading-none text-foreground sm:text-4xl">{value}</strong>{star && <span aria-hidden="true" className="text-lg text-primary">☆</span>}</div>
          <h2 className="mt-2 text-[10px] font-bold uppercase text-foreground sm:text-xs">{label}</h2>
          <p className="mx-auto mt-1 max-w-[185px] text-xs leading-snug text-muted-foreground">{description}</p>
        </div>)}
      </div>
      <p className="mx-auto mt-8 max-w-[1120px] px-5 text-center text-[11px] text-muted-foreground sm:px-8">Informações fornecidas para esta apresentação. Confirme indicadores e condições comerciais com a equipe MasterApp.</p>
    </section>

    <section id="sistema" className="scroll-mt-16 bg-card py-20 sm:py-28"><div className="mx-auto grid max-w-[1120px] items-center gap-16 px-5 sm:px-8 lg:grid-cols-[0.78fr_1.22fr]"><div><span className="text-xs font-bold uppercase tracking-widest text-primary">Visão do sistema</span><h2 className="mt-3 font-display text-3xl font-bold leading-tight sm:text-4xl">O controle que sua operação pede, em um só lugar.</h2><p className="mt-5 leading-relaxed text-muted-foreground">Uma visão prática dos pedidos e das etapas do delivery para ajudar sua equipe a seguir em frente.</p><ul className="mt-7 space-y-4 text-sm">{["Acompanhe o andamento dos pedidos", "Enxergue a fila de preparo", "Tenha as entregas no radar"].map((text) => <li key={text} className="flex items-center gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-success-soft text-success"><Check className="size-3.5" /></span>{text}</li>)}</ul><p className="mt-7 text-xs text-muted-foreground">Imagens de demonstração fornecidas por você. Os números exibidos não representam dados em tempo real.</p></div><div className="px-4 pb-10 pt-8 sm:px-8"><DashboardPreview /></div></div></section>

    <section id="recursos-operacao" aria-labelledby="recursos-operacao-title" className="border-y border-border bg-surface-warm py-20 sm:py-24">
      <div className="mx-auto max-w-[1120px] px-5 sm:px-8">
        <div className="mx-auto max-w-[720px] text-center">
          <span className="text-xs font-bold uppercase tracking-widest text-primary">Mais possibilidades para sua operação</span>
          <h2 id="recursos-operacao-title" className="mt-3 font-display text-3xl font-bold leading-tight text-foreground sm:text-4xl">Sua casa cheia. Sua operação no controle.</h2>
          <p className="mt-5 leading-relaxed text-muted-foreground">Do salão à cozinha, do caixa ao delivery: reúna o que sua equipe precisa para atender melhor e o que você precisa para gerir com mais confiança.</p>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {operationResources.map(({ icon: Icon, title, description }) => <article key={title} className="min-w-0 rounded-lg border border-border bg-card p-6 shadow-sm transition-colors hover:border-primary/40">
            <span className="grid size-10 place-items-center rounded-md bg-brand-soft text-primary"><Icon className="size-5" aria-hidden="true" /></span>
            <h3 className="mt-5 font-display text-lg font-semibold leading-snug text-foreground">{title}</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{description}</p>
          </article>)}
        </div>
        <div className="mt-10 flex flex-col items-center gap-4 text-center">
          <p className="font-display text-lg font-semibold text-foreground">Dê à sua equipe mais agilidade. Dê ao seu negócio mais direção.</p>
          <Button variant="hero" size="hero" asChild><a href="#planos">Encontrar meu plano <ArrowRight /></a></Button>
          <p className="max-w-[680px] text-xs leading-relaxed text-muted-foreground">Recursos apresentados como referência da solução. Confirme disponibilidade, integrações de pagamento e inclusão em cada plano com a equipe MasterApp.</p>
        </div>
      </div>
    </section>

    <ScreensGallery />

    <PricingSection />

    <section id="duvidas" className="scroll-mt-16 border-t border-border bg-background py-20 sm:py-24"><div className="mx-auto grid max-w-[1120px] gap-10 px-5 sm:px-8 md:grid-cols-[0.8fr_1.2fr]"><div><span className="text-xs font-bold uppercase tracking-widest text-primary">Dúvidas frequentes</span><h2 className="mt-3 font-display text-3xl font-bold sm:text-4xl">Ainda tem perguntas?</h2><p className="mt-4 text-sm leading-relaxed text-muted-foreground">Veja algumas respostas sobre esta apresentação do masterApp.</p></div><div className="divide-y divide-border border-y border-border">{faqs.map(({ question, answer }) => <details key={question} className="group py-5"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display font-semibold [&::-webkit-details-marker]:hidden">{question}<ChevronDown className="size-5 shrink-0 text-primary transition-transform group-open:rotate-180" /></summary><p className="max-w-xl pt-3 text-sm leading-relaxed text-muted-foreground">{answer}</p></details>)}</div></div></section>

    <section className="bg-primary py-16 text-primary-foreground sm:py-20"><div className="mx-auto flex max-w-[1120px] flex-col items-start justify-between gap-8 px-5 sm:px-8 md:flex-row md:items-center"><div><h2 className="max-w-xl font-display text-3xl font-bold leading-tight sm:text-4xl">Seu delivery tem muito para acontecer. Organize o caminho.</h2><p className="mt-3 text-sm text-primary-foreground/85">Conheça a visão do masterApp para a sua operação.</p></div><Button variant="heroOutline" size="hero" asChild><a href="#sistema">Ver o sistema <ArrowRight /></a></Button></div></section>
    <footer className="bg-preview py-8 text-preview-foreground"><div className="mx-auto flex max-w-[1120px] flex-col gap-4 px-5 sm:flex-row sm:items-center sm:justify-between sm:px-8"><span className="inline-flex items-center gap-2 font-display text-lg font-bold"><img src={brandSymbol} alt="" className="h-7 w-8 object-contain" width={32} height={28} />Master<span className="text-primary">App</span></span><p className="text-xs text-preview-muted">Uma apresentação para quem faz delivery acontecer.</p><nav aria-label="Links do rodapé" className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-preview-muted"><a href="/login" className="transition-colors hover:text-preview-foreground">Entrar</a><a href="/termos" className="transition-colors hover:text-preview-foreground">Termos de uso</a><a href="/privacidade" className="transition-colors hover:text-preview-foreground">Privacidade</a><a href="#inicio" className="transition-colors hover:text-preview-foreground">Voltar ao início ↑</a></nav></div></footer>
  </div>;
}