import Link from "next/link";
import { Brand, MarketingHeader } from "@/components/ui";

const benefits = [
  ["01", "Seu cardápio no ar em minutos", "Crie categorias, produtos, adicionais e publique um link elegante para seus clientes."],
  ["02", "Pedidos organizados", "Acompanhe cada pedido do recebimento à entrega, com operação simples para toda a equipe."],
  ["03", "Gestão que cabe no bolso", "Assinatura previsível, métricas essenciais e estrutura pronta para o seu crescimento."],
];

export default function Home() {
  return (
    <main>
      <MarketingHeader />
      <section className="saas-hero">
        <div className="hero-copy">
          <span className="kicker">CARDÁPIO DIGITAL · PEDIDOS · GESTÃO</span>
          <h1>Seu restaurante,<br /><em>mais vivo.</em></h1>
          <p>Uma plataforma completa para transformar o seu cardápio em uma experiência que vende — sem comissão por pedido e sem complicação.</p>
          <div className="hero-actions">
            <Link className="button primary" href="/cadastro">Começar teste grátis <span>→</span></Link>
            <Link className="button ghost" href="/loja/demo">Ver cardápio demo</Link>
          </div>
          <small>14 dias grátis · sem cartão · cancele quando quiser</small>
        </div>
        <div className="hero-product" aria-label="Prévia do painel Mesa Viva">
          <div className="mock-window">
            <div className="mock-top"><Brand compact /><span>● ● ●</span></div>
            <div className="mock-grid">
              <aside><b>Visão geral</b><span>Pedidos</span><span>Cardápio</span><span>Clientes</span></aside>
              <div className="mock-content">
                <span className="kicker">HOJE, 24 DE JULHO</span>
                <h3>Boa tarde, Bistrô Aurora.</h3>
                <div className="metrics">
                  <article><small>Faturamento</small><strong>R$ 2.840</strong><i>+18%</i></article>
                  <article><small>Pedidos</small><strong>64</strong><i>+12%</i></article>
                </div>
                <div className="orders-preview"><b>Pedidos recentes</b><span>#1048 · Brasa Nobre <i>Preparando</i></span><span>#1047 · Combo da casa <i>Novo</i></span></div>
              </div>
            </div>
          </div>
          <div className="floating-stat"><b>+31%</b><span>mais pedidos no mês</span></div>
        </div>
      </section>

      <section className="logo-strip"><span>FEITO PARA QUEM SERVE BEM</span><b>Hamburguerias</b><b>Pizzarias</b><b>Cafeterias</b><b>Restaurantes</b></section>

      <section className="table-digital-section">
        <div className="table-digital-copy">
          <span className="kicker">DO QR CODE AO PAGAMENTO</span>
          <h2>Transforme qualquer mesa<br />em um <em>ponto de pedido digital.</em></h2>
          <p>O cliente escaneia o QR Code, acessa o cardápio na hora e o garçom pode lançar pedidos direto para a cozinha, fechar a conta e gerar o Pix oficial do estabelecimento com mais segurança, sem depender de chave digitada manualmente.</p>
          <Link className="button dark" href="/cadastro">Digitalizar minhas mesas →</Link>
        </div>
        <div className="table-digital-flow" aria-label="Fluxo do pedido digital por mesa">
          <article><span>01</span><div><small>CLIENTE</small><h3>Escaneia o QR Code</h3><p>Cardápio aberto no celular, identificado pela mesa.</p></div></article>
          <article><span>02</span><div><small>GARÇOM</small><h3>Envia para a cozinha</h3><p>Itens, adicionais e observações chegam em tempo real.</p></div></article>
          <article><span>03</span><div><small>ESTABELECIMENTO</small><h3>Fecha com Pix oficial</h3><p>Valor exato e chave protegida, cadastrada pelo responsável.</p></div></article>
        </div>
      </section>

      <section className="section" id="recursos">
        <div className="section-title">
          <span className="kicker">SIMPLES POR FORA. PODEROSO POR DENTRO.</span>
          <h2>Tudo o que você precisa<br />para <em>vender melhor.</em></h2>
        </div>
        <div className="benefit-grid">
          {benefits.map(([number, title, text]) => (
            <article key={number}><span>{number}</span><h3>{title}</h3><p>{text}</p></article>
          ))}
        </div>
      </section>

      <section className="cta-panel">
        <div><span className="kicker">COMECE HOJE</span><h2>Seu próximo pedido<br />começa aqui.</h2></div>
        <div><p>Crie sua conta, configure seu estabelecimento e publique o primeiro cardápio ainda hoje.</p><Link className="button light" href="/cadastro">Criar minha conta →</Link></div>
      </section>
      <footer><Brand /><span>© 2026 Mesa Viva. Tecnologia para quem serve.</span><nav><Link href="/planos">Planos</Link><Link href="/login">Entrar</Link></nav></footer>
    </main>
  );
}
