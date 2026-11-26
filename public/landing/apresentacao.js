// Landing da página inicial: tábua giratória, planos, recursos e dúvidas. Carregada por components/landing/apresentacao-script.tsx.
(()=>{if(!document.getElementById('stage'))return;
{
const S={burger:'/images/landing-nova/lojas/burger.jpg',pizza:'/images/landing-nova/lojas/pizza.jpg',churrasco:'/images/landing-nova/lojas/churrasco.jpg',sushi:'/images/landing-nova/lojas/sushi.jpg',marmita:'/images/landing-nova/lojas/marmita.jpg',prato:'/images/landing-nova/lojas/prato.jpg',acai:'/images/landing-nova/lojas/acai.jpg',coffee:'/images/landing-nova/lojas/coffee.jpg',truck:'/images/landing-nova/lojas/truck.jpg',bar:'/images/landing-nova/lojas/bar.jpg',bebidas:'/images/landing-nova/lojas/bebidas.jpg'};
const P={b:['Básico',49.9,390],p:['Profissional',89.9,990],s:['Profissional Sênior',169.9,1738.9]};
const R$=v=>v.toLocaleString("pt-BR",{style:"currency",currency:"BRL"}),eqm=a=>Math.floor(a/12*100)/100;
const SEG=[
{n:'Lanchonete e hamburgueria',pic:'burger',line:'Pedido pelo link, cozinha avisada e motoboy saindo no ritmo da noite.',plan:'p',f:[['Cardápio por link e QR','Com adicionais e combos'],['Cozinha em tempo real','Fila de preparo com alerta sonoro'],['Delivery com motoboy','Despacho e acompanhamento'],['Impressão da comanda','Impressora térmica com adicionais']]},
{n:'Pizzaria',pic:'pizza',line:'Sexta à noite cheia sem perder pedido no telefone.',plan:'p',f:[['Pedido online','Link próprio e QR Code'],['Delivery com motoboy','Taxa e rota por pedido'],['Cozinha em tempo real','Do forno ao balcão'],['Pizza meio a meio','Dois sabores na mesma pizza']]},
{n:'Churrascaria e espetinho',pic:'churrasco',line:'Salão cheio, garçom lançando direto do celular, conta dividida sem confusão.',plan:'p',f:[['Mesas e comandas','Abertura ao fechamento'],['Garçom no celular','Pedido vai direto para a churrasqueira'],['Divisão de conta','E transferência de itens'],['Pedido pelo QR da mesa','Sem esperar o garçom']]},
{n:'Restaurante japonês',pic:'sushi',line:'Cardápio com foto valoriza cada peça e cada combinado.',plan:'p',f:[['Cardápio com fotos','Combinados e adicionais'],['Cozinha por estação','Sushi, quente e bebidas'],['Delivery','Despacho e acompanhamento'],['Mesas e comandas','Para o salão']]},
{n:'Comida caseira e marmitaria',pic:'marmita',line:'O prato do dia no WhatsApp do cliente antes do almoço.',plan:'b',f:[['Cardápio do dia','Atualize em minutos'],['Pedido por link','Para mandar no WhatsApp'],['Retirada e entrega','O cliente escolhe'],['Delivery com motoboy','Entrega no bairro']]},
{n:'Restaurante à la carte e por quilo',pic:'prato',line:'Salão, cozinha e caixa conversando sem papel.',plan:'p',f:[['Salão e garçom','Mesas, comandas e conta'],['Balança no caixa','Para venda por quilo'],['Cozinha em tempo real','Tempo de preparo por prato'],['Equipe com acessos','Cada função no seu lugar']]},
{n:'Açaiteria e sorveteria',pic:'acai',line:'Complementos sem erro e fila andando no balcão.',plan:'b',f:[['Complementos e adicionais','Montagem do copo'],['Totem de autoatendimento','O cliente monta sozinho'],['Painel de retirada','Chama o número na tela'],['PIX','Cobrança prática']]},
{n:'Cafeteria e doceria',pic:'coffee',line:'Do café da manhã à sobremesa, com cliente voltando sempre.',plan:'b',f:[['Caixa no balcão','Venda rápida'],['Programa de fidelidade','Cliente acumula e volta'],['Cardápio com fotos','Bolos e doces valorizados'],['Encomendas','Pedido para retirar no horário combinado']]},
{n:'Food truck, trailer e praça',pic:'truck',line:'Um celular vira caixa, cardápio e painel de retirada.',plan:'b',f:[['QR Code na fila','Cliente pede antes de chegar ao balcão'],['Caixa no celular','Sem computador'],['Painel de retirada','Chama pelo número'],['PIX','Cobrança na hora']]},
{n:'Bar, pub e adega',pic:'bar',line:'Comanda aberta a noite toda e estoque de bebida sob controle.',plan:'p',f:[['Comandas por mesa','Abertas até o fechamento'],['Garçom no celular','Pedido direto ao balcão'],['Estoque de bebidas','Entradas e saídas'],['Divisão de conta','Para a turma']]},
{n:'Distribuidora de bebidas',pic:'bebidas',line:'Pedido pelo link, motoboy na rua e estoque batendo no fim do dia.',plan:'s',f:[['Pedido por link e WhatsApp','Gelada na porta do cliente'],['Delivery com motoboy','Despacho e acompanhamento'],['Estoque','Entradas, saídas e alertas'],['Casco e fardo','Produto com e sem casco, e fardo fechado']]}
];
const stage=document.getElementById('stage'),board=document.getElementById('board'),itemsEl=document.getElementById('items');
const N=SEG.length,STEP=360/N;let cur=0,drag=0,geo={},sheetYear=false,phase=0;
const mod=n=>((n%N)+N)%N;
itemsEl.innerHTML=SEG.map((s,i)=>`<div class="item" data-i="${i}"><button aria-label="${s.n}: ver o que ganha"><div class="pic"><img src="${S[s.pic]}" alt="${s.n} usando o MasterApp" loading="${i<3?'eager':'lazy'}" decoding="async"><span class="cap">${s.n.split(' e ')[0]}<i> · com MasterApp</i></span></div></button></div>`).join('');
const items=[...itemsEl.children];
document.getElementById('dots').innerHTML=SEG.map((s,i)=>`<button aria-label="${s.n}" data-i="${i}"></button>`).join('');
document.querySelectorAll('#dots button').forEach(b=>b.onclick=()=>go(+b.dataset.i));
function layout(){
  const W=stage.clientWidth,H=stage.clientHeight,narrow=W<560;
  const BR=Math.min(W,H)/2-(narrow?24:12),cx=W/2,cy=H/2-(narrow?10:0);
  const big=BR*(narrow?1.16:1.0),small=BR*.42,RR=BR*.9;
  geo={W,H,BR,cx,cy,narrow};
  board.style.cssText=`width:${BR*2}px;height:${BR*2}px;left:${cx-BR}px;top:${cy-BR}px;transform:rotate(${(-phase+drag)*STEP}deg)`;
  items.forEach((el,i)=>{
    let d=((i-phase+drag)%N+N)%N;if(d>N/2)d-=N;
    const ad=Math.abs(d),t=Math.max(0,1-ad),e=t*t*(3-2*t);
    const ang=(-90+Math.max(-2,Math.min(2,d))*90)*Math.PI/180;
    const rx=cx+RR*Math.cos(ang),ry=cy+RR*Math.sin(ang)*.92;
    const x=rx+(cx-rx)*e,y=ry+(cy-ry)*e,sz=small+(big-small)*e;
    el.style.width=el.style.height=sz+"px";
    el.style.transform=`translate(${x-sz/2}px,${y-sz/2}px) rotate(${-2.5+(1-e)*d*-16}deg)`;
    el.style.opacity=ad<=1?1:Math.max(0,1-(ad-1)*2.5);
    el.style.zIndex=e>.5?20:10;el.classList.toggle("on",e>.5);
    el.style.pointerEvents=ad<=1.1?"auto":"none";
    if(!el.classList.contains('hov')){const k=Math.max(-1,Math.min(1,d)),pic=el.firstElementChild.firstElementChild;
      pic.style.setProperty('--ry',(k*-34).toFixed(2)+'deg');pic.style.setProperty('--rx',(Math.abs(k)*10).toFixed(2)+'deg');
      pic.style.setProperty('--gx',(k*90).toFixed(0)+'px');pic.style.setProperty('--gy',(Math.abs(k)*-30).toFixed(0)+'px');}
    el.querySelector("button").tabIndex=Math.round(d)===0?0:-1;
  });
}
const pad=n=>String(n).padStart(2,"0");
function render(){
  const s=SEG[cur],pl=P[s.plan];
  document.getElementById('segNum').textContent=pad(cur+1);
  document.getElementById('segTot').textContent=pad(N);
  document.getElementById('segName').textContent=s.n;
  document.getElementById('segLine').textContent=s.line;
  document.getElementById('segTags').innerHTML=s.f.map(f=>`<span${f[2]?' class="tbd" title="Ainda não existe no app"':''}>${f[0]}</span>`).join('');
  document.getElementById('segPrice').innerHTML=R$(pl[1])+'<small style="font:500 16px var(--f-sans),sans-serif;color:var(--mute)"> /mês</small>';
  document.getElementById('segPlan').textContent='plano '+pl[0];
  const dish=document.getElementById('segmentos');dish.classList.remove('swap');void dish.offsetWidth;dish.classList.add('swap');
  document.querySelectorAll('#dots button').forEach(b=>b.setAttribute('aria-current',+b.dataset.i===cur));
  document.querySelectorAll('#strip button').forEach(b=>b.setAttribute('aria-pressed',+b.dataset.i===cur));
  layout();
  if(!sheet.hidden)fillSheet();
}
const sheet=document.getElementById('sheet');
function fillSheet(){
  const s=SEG[cur],pl=P[s.plan],full=Math.round(pl[1]*1200)/100;
  document.getElementById('shNum').textContent=pad(cur+1)+' / '+pad(N);
  document.getElementById('shName').textContent=s.n;
  document.getElementById('shLine').textContent=s.line;
  document.getElementById('shTags').innerHTML=s.f.map(f=>`<span${f[2]?' class="tbd"':''}>${f[0]}</span>`).join('');
  document.getElementById('shPlan').textContent=pl[0];
  document.getElementById('shPm').textContent=R$(pl[1])+'/mês';
  document.getElementById('shPa').textContent=R$(eqm(pl[2]))+'/mês';
  document.getElementById('shSave').textContent='economize '+R$(full-pl[2])+' no ano';
  document.getElementById('shM').setAttribute('aria-pressed',!sheetYear);document.getElementById('shA').setAttribute('aria-pressed',sheetYear);
  document.getElementById('shGo').textContent='Testar 15 dias grátis · '+(sheetYear?R$(eqm(pl[2])):R$(pl[1]))+'/mês';
  const WA='<div class="perk wa"><b>Atendimento pelo WhatsApp</b><span>Incluso neste plano</span></div>',IA='<div class="perk ia"><b>Atendente de IA no WhatsApp</b><span>Incluso neste plano</span></div>';
  document.getElementById('shPerk').innerHTML={b:'<div class="perk off"><b>Atendimento pelo WhatsApp no Profissional, e atendente de IA no Sênior</b></div>',p:WA+'<div class="perk off"><b>Atendente de IA no plano Sênior</b></div>',s:IA+WA}[s.plan];
}
document.getElementById('shM').onclick=()=>{sheetYear=false;fillSheet()};
document.getElementById('shA').onclick=()=>{sheetYear=true;fillSheet()};
const toast=document.getElementById('toast');let toastT;
document.getElementById('shGo').onclick=()=>{const s=SEG[cur];location.href='/cadastro'};
function go(i){let dl=mod(i)-mod(Math.round(phase));if(dl>N/2)dl-=N;if(dl<-N/2)dl+=N;phase=Math.round(phase)+dl;stage.classList.remove('spin');spinFrom=phase;spinT=-1;waitT=0;cur=mod(phase);drag=0;render()}
let spinFrom=0,spinT=-1,waitT=0;
document.getElementById('prev').onclick=()=>go(cur-1);
document.getElementById('next').onclick=()=>go(cur+1);
document.getElementById('open').onclick=()=>{fillSheet();sheet.hidden=false;document.getElementById('close').focus()};
document.getElementById('close').onclick=()=>{sheet.hidden=true;document.getElementById('open').focus()};
items.forEach((el,i)=>el.querySelector('button').addEventListener('click',()=>{if(moved)return;if(i===cur){fillSheet();sheet.hidden=false}else go(i)}));
const chipsHtml=(dup)=>SEG.map((s,i)=>`<button data-i="${i}"${dup?' tabindex="-1" aria-hidden="true"':''}>${s.n}</button>`).join('');
document.getElementById('strip').innerHTML=chipsHtml(false)+chipsHtml(true);
document.querySelectorAll("#strip button").forEach(b=>b.onclick=()=>{go(+b.dataset.i);document.getElementById("inicio").scrollIntoView()});
{
  const tr=document.getElementById("strip"),half=()=>tr.scrollWidth/2,stepW=()=>tr.querySelector("button").offsetWidth+10;
  let paused=false,resumeT=null;
  const wrapPos=()=>{if(tr.scrollLeft>=half())tr.scrollLeft-=half();if(tr.scrollLeft<=0&&tr._back)tr.scrollLeft+=half()};
  const move=dir=>{if(dir<0&&tr.scrollLeft<stepW())tr.scrollLeft+=half();tr.scrollBy({left:dir*stepW(),behavior:"smooth"})};
  tr.addEventListener("scroll",()=>{clearTimeout(tr._t);tr._t=setTimeout(wrapPos,120)});
  const hold=()=>{paused=true;clearTimeout(resumeT)},release=()=>{clearTimeout(resumeT);resumeT=setTimeout(()=>paused=false,2500)};
  const strip=tr.parentElement;
  strip.addEventListener("pointerenter",hold);strip.addEventListener("pointerleave",release);
  strip.addEventListener("focusin",hold);strip.addEventListener("focusout",release);
  tr.addEventListener("touchstart",hold,{passive:true});tr.addEventListener("touchend",release);
  document.getElementById("stripPrev").onclick=()=>move(-1);
  document.getElementById("stripNext").onclick=()=>move(1);
  const still=matchMedia("(prefers-reduced-motion: reduce)").matches;
  if(!still)setInterval(()=>{if(!paused&&!document.hidden)move(1)},1000);
}
let sx=null,moved=false;
stage.addEventListener('pointerdown',e=>{sx=e.clientX;moved=false});
window.addEventListener('pointermove',e=>{if(sx===null)return;const dx=e.clientX-sx;if(Math.abs(dx)>6){moved=true;stage.classList.add('drag')}if(moved){drag=-dx/(geo.BR*.9);layout()}});
window.addEventListener('pointerup',()=>{if(sx===null)return;sx=null;stage.classList.remove('drag');if(moved){const k=Math.round(-drag);go(cur-k);setTimeout(()=>moved=false,50)}});
stage.addEventListener('keydown',e=>{if(e.key==='ArrowLeft')go(cur-1);if(e.key==='ArrowRight')go(cur+1)});
const ro=new ResizeObserver(()=>layout());
if(matchMedia('(hover:hover) and (prefers-reduced-motion:no-preference)').matches){
  stage.addEventListener('pointermove',e=>{if(sx!==null)return;const on=itemsEl.querySelector('.item.on .pic');if(!on)return;on.closest('.item').classList.add('hov');const b=on.getBoundingClientRect();const px=(e.clientX-b.left)/b.width-.5,py=(e.clientY-b.top)/b.height-.5;if(Math.abs(px)>.9||Math.abs(py)>.9){on.style.setProperty('--rx','0deg');on.style.setProperty('--ry','0deg');return}
    on.style.setProperty('--rx',(-py*9).toFixed(2)+'deg');on.style.setProperty('--ry',(px*11).toFixed(2)+'deg');on.style.setProperty('--gx',(px*-60).toFixed(0)+'px');on.style.setProperty('--gy',(py*-60).toFixed(0)+'px')});
  stage.addEventListener('pointerleave',()=>itemsEl.querySelectorAll('.pic').forEach(p=>{p.closest('.item').classList.remove('hov');p.style.setProperty('--rx','0deg');p.style.setProperty('--ry','0deg');p.style.setProperty('--gx','0px');p.style.setProperty('--gy','0px')}));
}ro.observe(stage);
{
  const hero=document.getElementById("inicio");let hold=false,seen=true,wait=null;
  const pause=()=>{hold=true;clearTimeout(wait)},resume=()=>{clearTimeout(wait);wait=setTimeout(()=>hold=false,1500)};
  for(const el of [stage,document.getElementById("segmentos"),sheet]){el.addEventListener("pointerenter",pause);el.addEventListener("pointerleave",resume);el.addEventListener("focusin",pause);el.addEventListener("focusout",resume)}
  stage.addEventListener("touchstart",pause,{passive:true});stage.addEventListener("touchend",resume);
  const io=new IntersectionObserver(es=>{seen=es[0].isIntersecting});io.observe(hero);
  if(!matchMedia("(prefers-reduced-motion: reduce)").matches){
    const DWELL=2600,MOVE=1700,ease=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;let last=performance.now();
    const tick=now=>{const dt=Math.min(64,now-last);last=now;
      if(!hold&&seen&&sheet.hidden&&sx===null&&!document.hidden){
        if(spinT<0){waitT+=dt;if(waitT>DWELL){spinT=0;spinFrom=Math.round(phase);stage.classList.add('spin')}}
        else{spinT=Math.min(1,spinT+dt/MOVE);phase=spinFrom+ease(spinT);const c=mod(Math.round(phase));if(c!==cur){cur=c;render()}else layout();
          if(spinT>=1){phase=spinFrom+1;spinT=-1;waitT=0;layout()}}
      }
      requestAnimationFrame(tick)};
    requestAnimationFrame(tick);
  }
}
const CHAT=[['in','Boa noite! Ainda dá pra pedir? 23h40 kkk'],['out','Boa noite! Dá sim, estamos abertos até meia-noite 🔥 Hoje tem picanha na chapa por R$ 69,90 e espetinho a R$ 9,00.','Atendente IA'],['in','Manda 1 picanha e 4 espetinhos de frango'],['out','Anotado: 1 picanha + 4 espetinhos = R$ 105,90. Entrega ou retirada?','Atendente IA'],['in','Entrega'],['out','Perfeito! Te mando o link para confirmar o endereço e pagar no PIX. Chega em uns 40 minutos.','Atendente IA']];
document.getElementById('chatBody').innerHTML=CHAT.map((m,i)=>`<div class="msg ${m[0]}" style="animation-delay:${.3+i*.45}s">${m[2]?`<em>${m[2]}</em>`:''}${m[1]}</div>`).join('');
const brl=v=>v.toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
let yearly=false;
function bill(){
  document.getElementById("bm").setAttribute("aria-pressed",!yearly);document.getElementById("ba").setAttribute("aria-pressed",yearly);
  document.getElementById("billHint").innerHTML=yearly?"Pagamento único por 12 meses, com desconto já aplicado.":"Prefere economizar? <b>No anual o Básico sai a R$ 32,50 por mês.</b>";
  document.querySelectorAll(".pbox").forEach(b=>{const m=+b.dataset.m,a=+b.dataset.a,full=Math.round(m*1200)/100,save=full-a,pct=Math.round(save/full*100),eq=Math.floor(a/12*100)/100;
    b.innerHTML=yearly?`<div class="pr">${brl(eq)} <small>/mês</small></div><p class="was">${brl(a)} por ano · de <s>${brl(full)}</s></p><span class="deal">Você economiza ${brl(save)} no ano</span>`
      :`<div class="pr">${brl(m)} <small>/mês</small></div><p class="was">ou ${brl(a)} no plano anual</p><button class="nudge" type="button">No anual: economize ${brl(save)} por ano →</button>`;});
  document.querySelectorAll(".nudge").forEach(n=>n.onclick=()=>{yearly=true;bill()});
}
document.getElementById("heroAnnual").addEventListener("click",()=>{yearly=true;bill()});
document.getElementById("bm").onclick=()=>{yearly=false;bill()};document.getElementById("ba").onclick=()=>{yearly=true;bill()};
bill();
const IC={
venda:'<path d="M4 7h16v11H4z"/><path d="M8 7V5h8v2M4 12h16"/>',
salao:'<path d="M4 10h16M6 10v8M18 10v8M9 6h6"/><circle cx="12" cy="6" r="1"/>',
cozinha:'<path d="M6 11a6 6 0 0 1 12 0v1H6z"/><path d="M4 15h16M7 19h10"/>',
entrega:'<circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M9 17h6M3 13h11l2-5h3l2 5v4h-2M3 13v4h2"/>',
whats:'<path d="M5 19l1.3-3.7A7 7 0 1 1 9 18.6z"/><path d="M9.5 10c.5 2 2 3.5 4.5 4.5"/>',
grana:'<circle cx="12" cy="12" r="8"/><path d="M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.5 0-2.5 1-2.5 2s1 1.6 2.5 2 2.5 1 2.5 2-1 2-2.5 2c-1 0-2-.5-2.5-1.5M12 6.5V8M12 16v1.5"/>',
estoque:'<path d="M4 8l8-4 8 4-8 4z"/><path d="M4 8v8l8 4 8-4V8M12 12v8"/>',
equipe:'<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 19c0-3 3-5 6-5s6 2 6 5M15 15c3 0 6 1 6 4"/>',
clientes:'<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
seguro:'<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>'};
const ico=k=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+IC[k]+'</svg>';
const PN={b:'Básico',p:'Profissional',s:'Sênior'},RANK={b:1,p:2,s:3};
const FEATS=[
{k:'venda',t:'Vendas e caixa',d:'Venda no balcão, na mesa ou pelo celular do cliente, e receba do jeito que ele preferir.',f:[['PDV completo','Caixa com leitor de código de barras e fechamento por funcionário','b'],['PIX automático','O pedido é confirmado sozinho quando o PIX cai','b'],['Cardápio digital com sua marca','Logo, capa, cores, fotos e adicionais','b'],['QR Code e link próprio','Na mesa, no balcão, no Instagram e no WhatsApp','b'],['Maquininha integrada','Stone, Cielo, Rede, Getnet, PagBank e Mercado Pago no caixa','p'],['Totem de autoatendimento','O cliente pede e paga sozinho','s']]},
{k:'salao',t:'Salão e garçom',d:'Do primeiro pedido ao fechamento da conta.',f:[['Comandas','Abertas por mesa ou por cliente','b'],['Reservas','Agenda de mesas com confirmação','b'],['Garçom no celular','Pedido lançado na mesa vai direto para a cozinha','p'],['Chamar o garçom','O cliente chama pela mesa e o garçom é avisado','p'],['Divisão de conta','Por pessoa ou por item, e transfere entre mesas','p']]},
{k:'cozinha',t:'Cozinha',d:'Cada pedido na tela certa, na ordem certa, com o tempo correndo.',f:[['Telas da cozinha (KDS)','Fila de preparo por estação','b'],['Tempo de preparo','Definido por você, com alerta quando atrasa','b'],['Alerta sonoro','Ninguém perde pedido novo','b'],['Impressão automática','Comanda na impressora térmica, com adicionais','b'],['Painel de retirada','Chama a senha do cliente na tela','b']]},
{k:'entrega',t:'Delivery',d:'Do despacho à porta do cliente.',f:[['Entregas com motoboy','Cadastro de motoboys e taxa de entrega','b'],['Acompanhamento do pedido','O cliente vê cada etapa até chegar','b'],['Retirada no balcão','Para quem prefere buscar','b'],['Canais de delivery','Pedidos de outros aplicativos na mesma fila','p'],['Central de despacho','Pedidos, motoboys, rotas e zonas numa tela','s']]},
{k:'whats',t:'WhatsApp e IA',d:'Seu WhatsApp vira um canal de vendas que não dorme.',f:[['Atendimento pelo WhatsApp','Conversas e pedidos numa caixa de entrada única','p'],['Atendente de IA','Responde, mostra o cardápio e fecha o pedido','s'],['Pedidos por ligação','Atendimento por telefone no mesmo sistema','s'],['Copiloto do gestor','Pergunte como foi o dia e receba a resposta com números','s']]},
{k:'grana',t:'Financeiro e fiscal',d:'O dinheiro organizado, e o contador recebendo tudo pronto.',f:[['Fechamento de caixa','Cada turno fechado e conferido','b'],['Relatórios de vendas','Por dia, produto e forma de pagamento','b'],['Financeiro','Contas a pagar e receber, conciliação e resultado','p'],['Nota fiscal','Emissão e arquivo digital das notas','p'],['Exportação para o contador','Arquivo contábil pronto para enviar','p'],['Margem dos pratos','Saiba quais dão lucro e quais só dão trabalho','p']]},
{k:'estoque',t:'Estoque e compras',d:'Estoque que baixa sozinho a cada venda.',f:[['Baixa automática','Cada venda tira do estoque, sem lançar de novo','b'],['Alerta de reposição','Aviso quando o item está acabando','b'],['Ficha técnica','Receita com ingredientes e custo por prato','p'],['Compras e fornecedores','Cotação, pedido e recebimento','p'],['Validade e lotes','Controle de validade e temperatura','s'],['Balança integrada','Venda por quilo direto no caixa','s']]},
{k:'equipe',t:'Equipe',d:'Cada pessoa vê só o que precisa para trabalhar.',f:[['Acessos por função','Caixa, cozinha, motoboy e gerente','b'],['Escalas','Horários e cobertura dos dias de pico','p'],['Metas e desempenho','Acompanhe a equipe com números','s'],['Treinamentos','Conteúdos para treinar quem chega','s']]},
{k:'clientes',t:'Clientes e fidelidade',d:'Quem pediu uma vez volta a pedir.',f:[['Cadastro do cliente','Histórico de pedidos e preferências','p'],['Programa de fidelidade','Pontos e recompensas para quem volta','p'],['Campanhas no WhatsApp','Promoções para grupos de clientes','p'],['Cupons de desconto','Com regra e validade','p']]},
{k:'seguro',t:'Segurança e controle',d:'Tudo no seu controle, de uma loja a uma rede.',f:[['Login com verificação','Proteção extra para o acesso do dono','b'],['Central de equipamentos','Impressora, gaveta, maquininha e balança num lugar só','p'],['Registro de tudo','Quem fez o quê e quando, no caixa e no sistema','s'],['Várias lojas','Cada unidade separada, com visão da rede','s']]}];
let pf='all';
const fwrap=document.getElementById('fwrap');
fwrap.innerHTML=FEATS.map(c=>'<div class="farea"><h3><span class="ic">'+ico(c.k)+'</span>'+c.t+'</h3><p>'+c.d+'</p><div class="fgrid">'+c.f.map(x=>'<div class="fcard" data-p="'+x[2]+'"><b>'+x[0]+'</b><span>'+x[1]+'</span><em class="pl '+x[2]+'">'+(x[2]==='b'?'Todos os planos':x[2]==='p'?'Profissional e Sênior':'Sênior')+'</em></div>').join('')+'</div></div>').join('');
function filt(){
  document.querySelectorAll('#pfilter button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.p===pf));
  document.querySelectorAll('.fcard').forEach(c=>c.classList.toggle('off',pf!=='all'&&RANK[c.dataset.p]>RANK[pf]));
  const n=pf==='all'?document.querySelectorAll('.fcard').length:[...document.querySelectorAll('.fcard')].filter(c=>RANK[c.dataset.p]<=RANK[pf]).length;
  document.getElementById('fcount').textContent=pf==='all'?n+' recursos em '+FEATS.length+' áreas, todos no mesmo sistema.':'O plano '+PN[pf]+' traz '+n+' destes recursos.';
}
document.querySelectorAll('#pfilter button').forEach(b=>b.onclick=()=>{pf=b.dataset.p;filt()});
filt();
const FAQ=[
["Qual a diferença entre o mensal e o anual?","No mensal você paga todo mês. No anual paga uma vez por 12 meses e economiza: o Básico sai a R$ 32,50 por mês, e a economia chega a R$ 299,90 no ano no plano Sênior."],
['O que é o atendimento pelo WhatsApp?','No plano Profissional, as conversas do WhatsApp da sua loja entram no MasterApp e podem virar pedido. No Profissional Sênior, uma atendente de IA responde seus clientes e fecha o pedido a qualquer hora, mesmo com a loja sem ninguém no celular.'],
['Preciso instalar algum aplicativo?','Não. O MasterApp abre no navegador do computador, do tablet ou do celular. O seu cliente também pede sem baixar nada.'],
['Serve para o meu tipo de negócio?','Atendemos lanchonetes, pizzarias, churrascarias, restaurantes, japoneses, marmitarias, açaí, cafeterias, food trucks, bares e distribuidoras.'],
['Cobram taxa por pedido?','Não. Você paga a mensalidade do plano e as vendas são todas suas.'],
['Funciona com impressora térmica e balança?','Sim, a impressora térmica imprime a comanda com os adicionais, e a balança pode ser ligada ao caixa.']
];
document.getElementById('faq').innerHTML=FAQ.map(q=>`<details><summary>${q[0]}</summary><p>${q[1]}</p></details>`).join('');
go(0);
}
})();
