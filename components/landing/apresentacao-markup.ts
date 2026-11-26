// HTML estático da landing (página inicial). O comportamento fica em public/landing/apresentacao.js.
export const apresentacaoMarkup = `<header class="top"><div class="wrap">
  <a class="logo" href="#inicio">Master<b>App</b></a>
  <nav aria-label="Seções"><a href="#segmentos">Para quem é</a><a href="#operacao">Como funciona</a><a href="#cliente">Seu cliente</a><a href="#whatsapp">WhatsApp e IA</a><a href="#recursos">Recursos</a><a href="#planos">Planos</a><a href="#duvidas">Dúvidas</a></nav>
  <a class="enter" href="/login">Entrar</a><a class="btn main" href="/cadastro">Testar<span class="ln"> 15 dias</span> grátis</a>
</div></header>

<section class="hero" id="inicio">
  <div class="wrap">
    <div class="intro">
      <p class="mono eyebrow">MasterApp · sistema para food service</p>
      <h1>Um sistema para cada tipo de cozinha.</h1>
    </div>
    <div class="dish" id="segmentos" aria-live="polite">
      <div class="counter mono"><span id="segNum">01</span><i></i><span id="segTot">11</span></div>
      <h2 class="dname" id="segName"></h2>
      <p class="dline" id="segLine"></p>
      <div class="dtags" id="segTags"></div>
      <div class="dbuy">
        <div class="dprice"><strong id="segPrice"></strong><span class="mono" id="segPlan"></span></div>
        <button class="pill" id="open">Ver e testar</button>
      </div>
      <p class="dsub">Sem taxa por pedido · 15 dias grátis · <a href="#planos" id="heroAnnual">a partir de R$ 32,50/mês no anual</a></p>
    </div>
    <div class="stage" id="stage" aria-label="Tábua dos tipos de negócio. Arraste para girar.">
      <div class="spot" aria-hidden="true"></div>
      <div class="board" id="board"><img src="/images/landing-nova/tabua.webp" alt=""><svg viewBox="0 0 1000 1000" aria-hidden="true"><defs><path id="rim" d="M500,500 m-438,0 a438,438 0 1,1 876,0 a438,438 0 1,1 -876,0"/></defs><text><textPath href="#rim">MASTERAPP · LANCHONETE · PIZZARIA · CHURRASCO · JAPONÊS · MARMITA · RESTAURANTE · AÇAÍ · CAFÉ · FOOD TRUCK · BAR · BEBIDAS ·</textPath></text></svg></div>
      <div id="items"></div>
      <p class="hint mono">Gire a tábua</p>
      <div class="dots" id="dots" aria-label="Escolher negócio"></div>
      <div class="arrows"><button id="prev" aria-label="Negócio anterior">‹</button><button id="next" aria-label="Próximo negócio">›</button></div>
    </div>
  </div>
  <div class="sheet" id="sheet" role="dialog" aria-modal="false" aria-labelledby="shName" hidden>
    <button class="close" id="close" aria-label="Fechar">×</button>
    <p class="mono" style="color:var(--ember2)" id="shNum"></p>
    <h3 id="shName"></h3>
    <p class="muted" style="margin-top:10px" id="shLine"></p>
    <p class="mono lbl">Recursos</p>
    <div class="dtags" id="shTags"></div>
    <p class="mono lbl">No WhatsApp</p>
    <div id="shPerk" class="tiers" style="margin-top:10px"></div>
    <p class="mono lbl">Pagamento · plano <span id="shPlan"></span></p>
    <div class="opts"><button id="shM" aria-pressed="true">Mensal<b id="shPm"></b></button><button id="shA" aria-pressed="false">Anual<b id="shPa"></b><small id="shSave"></small></button></div>
    <button class="pill wide" id="shGo"></button>
  </div>
  <div class="toast" id="toast" role="status"></div>
</section>

<nav class="strip" aria-label="Escolha o tipo de negócio"><button class="nav l" id="stripPrev" aria-label="Voltar a lista">‹</button><div class="track" id="strip"></div><button class="nav r" id="stripNext" aria-label="Avançar a lista">›</button></nav>

<section class="band impact" id="operacao">
  <div class="wrap">
    <div>
      <p class="mono kick"><span>01</span><i></i><span>06</span><b>Como funciona</b></p><h2>Do pedido à entrega, em uma tela só.</h2>
      <p class="lead">O pedido chega pelo QR Code, pelo link ou pelo garçom, vai direto para a cozinha, passa pelo caixa e sai com o motoboy. Tudo acompanhado em tempo real.</p>
      <div class="nums" id="nums">
        <div><strong data-to="0" data-suf="%">0%</strong><span>de taxa por pedido</span></div>
        <div><strong data-to="15">15</strong><span>dias para testar grátis</span></div>
        <div><strong data-to="11">11</strong><span>tipos de negócio atendidos</span></div>
      </div>
    </div>
    <div class="orb"><img src="/images/landing-nova/forno.jpg" alt="Forno a lenha aceso com pizza assando" loading="lazy"></div>
  </div>
  <div class="wrap">
    <div class="steps">
      <div class="step"><img class="shot" src="/images/landing-nova/passo-cardapio.jpg" alt="Celular fotografando um hambúrguer para o cardápio" loading="lazy"><p class="mono stepn">01 / 03</p><h3>Monte seu cardápio</h3><p>Fotos, categorias, adicionais e preços. Com a cara da sua marca.</p></div>
      <div class="step"><img class="shot" src="/images/landing-nova/passo-qr.jpg" alt="Cliente escaneando o QR Code na mesa" loading="lazy"><p class="mono stepn">02 / 03</p><h3>Compartilhe o link e o QR</h3><p>Na mesa, no balcão, no Instagram e no WhatsApp. Sem baixar aplicativo.</p></div>
      <div class="step"><img class="shot" src="/images/landing-nova/passo-entrega.jpg" alt="Entregador passando o pedido ao cliente na porta" loading="lazy"><p class="mono stepn">03 / 03</p><h3>Receba, prepare e entregue</h3><p>Cozinha, caixa e motoboy acompanham o mesmo pedido.</p></div>
    </div>
  </div>
</section>

<section class="band client" id="cliente" style="background:var(--bg2)">
  <div class="wrap">
    <div class="phone real" aria-label="Cardápio real do MasterApp no celular do cliente"><img src="/images/landing-nova/cardapio-loja.jpg" alt="Cardápio da loja de teste aberto no celular, feito no MasterApp"></div>
    <div>
      <p class="mono kick"><span>02</span><i></i><span>06</span><b>Seu cliente</b></p><h2>Seu cliente pede pelo celular e acompanha até chegar.</h2>
      <ul class="ticks">
        <li><span class="dot"></span><div><b>Link com o nome da sua loja</b><br><span class="muted">Coloque na bio do Instagram e no status do WhatsApp.</span></div></li>
        <li><span class="dot"></span><div><b>QR Code na mesa e no balcão</b><br><span class="muted">O cliente escaneia, escolhe e pede.</span></div></li>
        <li><span class="dot"></span><div><b>Acompanhamento do pedido</b><br><span class="muted">Recebido, em preparo, saiu para entrega.</span></div></li>
        <li><span class="dot"></span><div><b>Pagamento por PIX</b><br><span class="muted">Mais prático para o cliente, mais fácil de conferir.</span></div></li>
      </ul>
      <p class="small muted" style="margin-top:18px">Cardápio real feito no MasterApp.</p>
    </div>
  </div>
</section>

<section class="band wa-sec" id="whatsapp">
  <div class="wrap">
    <div>
      <p class="mono kick"><span>03</span><i></i><span>06</span><b>WhatsApp e IA</b></p><h2>Seu WhatsApp vendendo sozinho, até de madrugada.</h2>
      <p class="lead">O que um sistema comum não faz: as conversas do WhatsApp entram no MasterApp, viram pedido e chegam à cozinha. No plano completo, uma atendente de IA atende e fecha o pedido por você.</p>
      <div class="tiers">
        <div class="perk wa"><b>Profissional · Atendimento pelo WhatsApp</b><span>Conversas e pedidos do WhatsApp numa tela só. Sua equipe responde, acompanha e não perde nenhum cliente.</span></div>
        <div class="perk ia"><b>Profissional Sênior · Atendente de IA</b><span>Responde dúvidas, mostra o cardápio, anota e fecha o pedido a qualquer hora, e ele já cai na cozinha. Você ajusta o jeito dela falar, e sua equipe assume a conversa quando quiser.</span></div>
      </div>
      <div class="cta"><a class="btn main" href="#planos">Ver os planos</a></div>
      
    </div>
    <div class="chat" aria-label="Exemplo de conversa da atendente de IA no WhatsApp">
      <div class="hd"><span class="av">BB</span><div><b>Brasa do Bairro</b><small>online</small></div></div>
      <div class="body" id="chatBody"></div>
    </div>
  </div>
</section>

<section class="band feats" id="recursos">
  <div class="wrap">
    <div class="feats-head">
      <p class="mono kick"><span>04</span><i></i><span>06</span><b>Recursos</b></p><h2>Tudo o que você leva, por dentro do MasterApp.</h2>
      <p class="lead">Do caixa à contabilidade, do salão ao motoboy. Um sistema só, no lugar de cinco programas diferentes.</p>
    </div>
    <figure class="kit"><img src="/images/landing-nova/balcao.jpg" alt="Balcão com maquininha, impressora de comanda e tablet da cozinha" loading="lazy"><figcaption>Maquininha, impressora, tela da cozinha e celular conversando com o mesmo sistema.</figcaption></figure>
    <div class="fbar">
      <span class="small muted">Ver o que vem no plano:</span>
      <div class="seg" role="group" aria-label="Filtrar por plano" id="pfilter"><button data-p="all" aria-pressed="true">Todos</button><button data-p="b" aria-pressed="false">Básico</button><button data-p="p" aria-pressed="false">Profissional</button><button data-p="s" aria-pressed="false">Sênior</button></div>
    </div>
    <div class="fwrap" id="fwrap"></div>
    <p class="small muted" id="fcount" style="margin-top:18px"></p>
  </div>
</section>

<section class="band" id="planos">
  <div class="wrap">
    <p class="mono kick"><span>05</span><i></i><span>06</span><b>Planos</b></p><h2>Preço que cabe no começo e acompanha o crescimento.</h2>
    <p class="lead">Mensalidade fixa, sem comissão sobre as vendas. Teste 15 dias antes de decidir.</p>
    <div class="billing">
      <div class="seg" role="group" aria-label="Forma de pagamento"><button id="bm" aria-pressed="true">Mensal</button><button id="ba" aria-pressed="false">Anual <span class="save">economize até R$ 299,90</span></button></div>
      <p id="billHint" class="small"></p>
    </div>
    <div class="annual" id="annualBox">
      <h3>Vantagens de assinar o anual</h3>
      <ul>
        <li><b>Economia de até R$ 299,90 no ano</b><span>Você paga menos do que 12 mensalidades.</span></li>
        <li><b>Básico sai a R$ 32,50 por mês</b><span>O menor preço do MasterApp.</span></li>
        <li><b>Paga uma vez e esquece</b><span>Sem boleto ou cobrança todo mês.</span></li>
        
      </ul>
    </div>
    <div class="plans">
      <article class="plan"><h3>Básico</h3><div class="pbox" data-m="49.90" data-a="390"></div><p class="fits">Food truck, praça, marmitaria, açaí, café</p><ul><li>1 estabelecimento</li><li>Até 100 produtos</li><li>Até 5 funcionários</li><li>Caixa, garçom e entrega</li><li>Até 500 pedidos por mês</li></ul><a class="btn ghost" href="/cadastro">Começar no Básico</a></article>
      <article class="plan destaque"><span class="badge">Mais escolhido</span><h3>Profissional</h3><div class="pbox" data-m="89.90" data-a="990"></div><p class="fits">Lanchonete, pizzaria, japonês, bar, churrascaria</p><div class="perk wa"><b>Atendimento pelo WhatsApp</b><span>Conversas e pedidos do WhatsApp dentro do sistema</span></div><ul><li>Tudo do Básico</li><li>2 estabelecimentos</li><li>Produtos ilimitados</li><li>Até 15 funcionários e 4 caixas</li><li>Cozinha em tempo real</li><li>Até 2.000 pedidos por mês</li></ul><a class="btn main" href="/cadastro">Quero o Profissional</a></article>
      <article class="plan ai"><span class="badge">Completo</span><h3>Profissional Sênior</h3><div class="pbox" data-m="169.90" data-a="1738.90"></div><p class="fits">Restaurantes grandes, redes, distribuidoras</p><div class="perk ia"><b>Atendente de IA no WhatsApp</b><span>Atende e fecha pedidos a qualquer hora, e sua equipe assume quando quiser</span></div><ul><li>Tudo do Profissional, com WhatsApp</li><li>Estabelecimentos ilimitados</li><li>Equipe e caixas ilimitados</li><li>Pedidos ilimitados</li><li>Impressoras ilimitadas</li></ul><a class="btn ghost" href="/cadastro">Quero sem limites</a></article>
    </div>
  </div>
</section>

<section class="band faq" id="duvidas" style="background:var(--bg2)">
  <div class="wrap">
    <div><p class="mono kick"><span>06</span><i></i><span>06</span><b>Dúvidas</b></p><h2>Dúvidas de quem está começando.</h2><p class="lead">Se a sua não estiver aqui, teste 15 dias grátis e veja na prática.</p></div>
    <div id="faq"></div>
  </div>
</section>

<section class="band final">
  <div class="wrap"><div><p class="mono kick"><b>15 dias grátis · sem taxa por pedido</b></p><h2>Seu negócio aberto no celular de cada cliente.</h2></div><a class="btn main" href="/cadastro">Testar 15 dias grátis</a></div>
</section>
<footer><div class="wrap"><span class="logo" style="color:var(--ink)">Master<b>App</b></span><nav aria-label="Links do rodapé"><a href="/termos">Termos de uso</a><a href="/privacidade">Privacidade</a><a href="/login">Entrar</a></nav></div></footer>`;
