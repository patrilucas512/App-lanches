import { createAdminClient } from "@/lib/supabase/admin";
import { hasActiveGateway, prepareWhatsAppPayment } from "@/lib/ai-attendant/whatsapp-commerce";

type Admin = ReturnType<typeof createAdminClient>;
type Cart = {
  id:string; establishment_id:string; connection_id?:string|null; conversation_id?:string|null; contact_id?:string|null;
  channel_type?:"whatsapp"|"voice"|"web_chat"|"manual"; voice_call_id?:string|null; web_chat_session_id?:string|null; customer_id?:string|null;
  status:string; state:string; customer_name:string; customer_phone:string; fulfillment_type?:string|null;
  delivery_address?:Record<string,string>|null; payment_method?:string|null; cash_received_cents?:number|null;
  coupon_code?:string|null; context:Record<string,unknown>; expires_at:string;
  recovery_sent_at?:string|null; upsell_offer_count?:number; upsell_accepted_count?:number;
};
type Product = { id:string; name:string; price_cents:number; ingredients?:string[]; active:boolean };
type OrderReply = { handled:boolean; answer?:string; intent?:string; toolName?:string; shouldHandoff?:boolean };

export const normalizeOrderText = (value:string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9,.-]+/g," ").replace(/\s+/g," ").trim();
const money = (value:number) => (value/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const openStatuses=["active","awaiting_information","awaiting_confirmation"];

export function parseOrderQuantity(message:string) {
  const normalized=normalizeOrderText(message);
  const digit=normalized.match(/\b(\d{1,3})\s*(?:x|unidades?|unds?)?\b/);
  const words:Record<string,number>={um:1,uma:1,dois:2,duas:2,tres:3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,dez:10};
  const word=Object.entries(words).find(([key])=>new RegExp(`\\b${key}\\b`).test(normalized));
  return Math.min(99,Math.max(1,digit?Number(digit[1]):word?.[1]||1));
}

export function parseDeliveryAddress(message:string) {
  const parts=message.split(/[,;\n]/).map(value=>value.trim()).filter(Boolean);
  if(parts.length<3) return null;
  const streetAndNumber=parts[0].match(/^(.*?)[,\s]+(?:n[ºo]?\s*)?(\d+[a-zA-Z-]*)$/);
  const separateNumber=parts[1]?.match(/^(?:n[ºo]?\s*)?(\d+[a-zA-Z-]*)$/i);
  const street=streetAndNumber?.[1]?.trim() || (separateNumber?parts[0]:"");
  const number=streetAndNumber?.[2] || separateNumber?.[1] || "";
  const neighborhood=parts[separateNumber?2:1] || "";
  const remaining=parts.slice(separateNumber?3:2);
  const reference=remaining.join(", ").replace(/^refer[eê]ncia\s*:?\s*/i,"");
  if(street.length<3||!number||neighborhood.length<2) return null;
  return {street,number,neighborhood,reference,complement:""};
}

async function log(admin:Admin,cart:Cart,messageId:string,eventType:string,fromState:string,toState:string,metadata:Record<string,unknown>={}) {
  await admin.from("whatsapp_cart_events").insert({establishment_id:cart.establishment_id,cart_id:cart.id,conversation_id:cart.channel_type==="whatsapp"?cart.conversation_id||null:null,message_id:cart.channel_type==="whatsapp"?messageId:null,event_type:eventType,from_state:fromState,to_state:toState,metadata:{...metadata,channel_type:cart.channel_type||"whatsapp",voice_call_id:cart.voice_call_id||null,web_chat_session_id:cart.web_chat_session_id||null}});
}

async function changeCart(admin:Admin,cart:Cart,messageId:string,patch:Record<string,unknown>,eventType:string) {
  const from=cart.state; const to=String(patch.state||cart.state);
  const {data,error}=await admin.from("whatsapp_carts").update({...patch,updated_at:new Date().toISOString(),expires_at:new Date(Date.now()+2*60*60*1000).toISOString()}).eq("id",cart.id).eq("establishment_id",cart.establishment_id).select("*").single();
  if(error) throw error;
  await log(admin,cart,messageId,eventType,from,to);
  return data as Cart;
}

type ConversationOrderInput = {admin:Admin;establishmentId:string;channel?:"whatsapp"|"voice"|"web_chat";connectionId?:string;conversationId?:string;contactId?:string;waId?:string;profileName?:string;voiceCallId?:string;webChatSessionId?:string;customerId?:string|null;customerPhone?:string;customerName?:string;messageId:string;text:string};

async function loadCart(admin:Admin,input:ConversationOrderInput,create:boolean) {
  const channel=input.channel||"whatsapp";
  let query=admin.from("whatsapp_carts").select("*").eq("establishment_id",input.establishmentId).eq("channel_type",channel).in("status",openStatuses);
  query=channel==="voice"?query.eq("voice_call_id",input.voiceCallId||""):channel==="web_chat"?query.eq("web_chat_session_id",input.webChatSessionId||""):query.eq("conversation_id",input.conversationId||"");
  const {data:existing}=await query.maybeSingle();
  if(existing) {
    if(new Date(existing.expires_at).getTime()<=Date.now()) {
      await admin.from("whatsapp_carts").update({status:"expired",state:"completed",updated_at:new Date().toISOString()}).eq("id",existing.id);
    } else return existing as Cart;
  }
  if(!create) return null;
  const phone=(channel==="whatsapp"?(input.waId||""):(input.customerPhone||"")).replace(/\D/g,"");
  const name=(channel==="whatsapp"?(input.profileName||""):(input.customerName||"")).trim().slice(0,120)||(channel==="voice"?"Cliente por telefone":channel==="web_chat"?"Visitante do site":"Cliente WhatsApp");
  const identity=channel==="voice"?{channel_type:"voice",voice_call_id:input.voiceCallId,customer_id:input.customerId||null}:channel==="web_chat"?{channel_type:"web_chat",web_chat_session_id:input.webChatSessionId,customer_id:input.customerId||null}:{channel_type:"whatsapp",connection_id:input.connectionId,conversation_id:input.conversationId,contact_id:input.contactId};
  const {data,error}=await admin.from("whatsapp_carts").insert({establishment_id:input.establishmentId,...identity,customer_name:name,customer_phone:phone,state:"browsing",status:"active"}).select("*").single();
  if(error) throw error;
  return data as Cart;
}

async function productOptions(admin:Admin,establishmentId:string,productId:string) {
  const [{data:variations},{data:links}]=await Promise.all([
    admin.from("product_variations").select("id,name,price_delta_cents").eq("establishment_id",establishmentId).eq("product_id",productId).eq("active",true).order("sort_order"),
    admin.from("product_addon_groups").select("addon_group_id,addon_groups(id,name,min_choices,max_choices,required,active,addons(id,name,price_cents,active,sort_order))").eq("establishment_id",establishmentId).eq("product_id",productId),
  ]);
  const groups=(links||[]).map((link:Record<string,unknown>)=>Array.isArray(link.addon_groups)?link.addon_groups[0]:link.addon_groups).filter((group:Record<string,unknown>|null)=>group&&group.active!==false).map((group:Record<string,unknown>)=>({...group,addons:(group.addons as Array<Record<string,unknown>>||[]).filter(addon=>addon.active!==false).sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0))}));
  return {variations:variations||[],groups};
}

async function addPendingItem(admin:Admin,cart:Cart,messageId:string) {
  const pending=(cart.context?.pending_item||{}) as Record<string,unknown>;
  const productId=String(pending.product_id||"");
  const {data:product}=await admin.from("products").select("id,name,price_cents,active").eq("id",productId).eq("establishment_id",cart.establishment_id).eq("active",true).maybeSingle();
  if(!product) throw new Error("O produto não está mais disponível.");
  const variationId=pending.variation_id?String(pending.variation_id):null;
  const {data:variation}=variationId?await admin.from("product_variations").select("id,name,price_delta_cents").eq("id",variationId).eq("product_id",product.id).eq("establishment_id",cart.establishment_id).eq("active",true).maybeSingle():{data:null};
  const addons=(pending.addons||[]) as Array<{id:string;group_id:string;name:string;price_cents:number;quantity:number}>;
  const quantity=Number(pending.quantity||1);
  const unit=product.price_cents+Number(variation?.price_delta_cents||0)+addons.reduce((sum,item)=>sum+item.price_cents*item.quantity,0);
  const {error}=await admin.from("whatsapp_cart_items").insert({establishment_id:cart.establishment_id,cart_id:cart.id,product_id:product.id,variation_id:variation?.id||null,quantity,selected_addons:addons,product_name:product.name,variation_name:variation?.name||null,unit_price_cents:unit,total_cents:unit*quantity});
  if(error) throw error;
  cart=await changeCart(admin,cart,messageId,{state:"building_cart",status:"active",context:{}},"item_added");
  let answer=`Adicionei ${quantity}× ${product.name}${variation?.name?` (${variation.name})`:""}. Quer acrescentar mais alguma coisa ou finalizar o pedido?`;
  const {data:connection}=cart.channel_type!=="whatsapp"?{data:{upsell_enabled:false}}:await admin.from("whatsapp_connections").select("upsell_enabled").eq("id",cart.connection_id).eq("establishment_id",cart.establishment_id).maybeSingle();
  if(connection?.upsell_enabled&&Number(cart.upsell_offer_count||0)<1) {
    const {data:items}=await admin.from("whatsapp_cart_items").select("product_id").eq("cart_id",cart.id);
    const excluded=(items||[]).map((item:{product_id:string})=>item.product_id);
    let query=admin.from("products").select("id,name,price_cents,ingredients,active").eq("establishment_id",cart.establishment_id).eq("active",true).neq("id",product.id).order("featured",{ascending:false}).limit(1);
    if(excluded.length) query=query.not("id","in",`(${excluded.join(",")})`);
    const {data:suggestions}=await query;
    const suggestion=(suggestions||[])[0] as Product|undefined;
    if(suggestion) {
      const context={upsell_product:suggestion};
      await admin.from("whatsapp_carts").update({context,upsell_offer_count:Number(cart.upsell_offer_count||0)+1,updated_at:new Date().toISOString()}).eq("id",cart.id).eq("establishment_id",cart.establishment_id);
      cart={...cart,context,upsell_offer_count:Number(cart.upsell_offer_count||0)+1};
      answer+=`\n\nQue tal acrescentar ${suggestion.name} por ${money(suggestion.price_cents)}? Responda SIM ou NÃO.`;
    }
  }
  return {cart,answer};
}

async function askNextAddon(admin:Admin,cart:Cart,messageId:string) {
  const pending=(cart.context?.pending_item||{}) as Record<string,unknown>;
  const groups=(pending.groups||[]) as Array<Record<string,unknown>>;
  const index=Number(pending.group_index||0);
  if(index>=groups.length) return addPendingItem(admin,cart,messageId);
  const group=groups[index]; const addons=(group.addons||[]) as Array<Record<string,unknown>>;
  cart=await changeCart(admin,cart,messageId,{state:"selecting_addons",status:"awaiting_information",context:{pending_item:pending}},"addon_requested");
  const limits=Number(group.min_choices||0)>0?`Escolha de ${group.min_choices} até ${group.max_choices}.`:`Opcional: escolha até ${group.max_choices}, ou envie 0 para pular.`;
  return {cart,answer:`${group.name}: ${limits}\n${addons.map((addon,index)=>`${index+1}. ${addon.name}${Number(addon.price_cents)?` (+${money(Number(addon.price_cents))})`:""}`).join("\n")}`};
}

async function beginProduct(admin:Admin,cart:Cart,messageId:string,product:Product,quantity:number) {
  const options=await productOptions(admin,cart.establishment_id,product.id);
  const pending={product_id:product.id,product_name:product.name,quantity,variation_id:null,variation_name:null,addons:[],groups:options.groups,group_index:0};
  if(options.variations.length) {
    cart=await changeCart(admin,cart,messageId,{state:"selecting_variant",status:"awaiting_information",context:{pending_item:{...pending,variations:options.variations}}},"variant_requested");
    return {cart,answer:`Escolha a variação de ${product.name}:\n${options.variations.map((item:{name:string;price_delta_cents:number},index:number)=>`${index+1}. ${item.name}${item.price_delta_cents?` (+${money(item.price_delta_cents)})`:""}`).join("\n")}`};
  }
  cart=await changeCart(admin,cart,messageId,{context:{pending_item:pending}},"product_selected");
  return askNextAddon(admin,cart,messageId);
}

async function recalculate(admin:Admin,cart:Cart) {
  const {data:items}=await admin.from("whatsapp_cart_items").select("*").eq("cart_id",cart.id).eq("establishment_id",cart.establishment_id).order("created_at");
  let subtotal=0;
  for(const item of items||[]) {
    const [{data:product},{data:variation}]=await Promise.all([
      admin.from("products").select("name,price_cents,active").eq("id",item.product_id).eq("establishment_id",cart.establishment_id).maybeSingle(),
      item.variation_id?admin.from("product_variations").select("name,price_delta_cents,active").eq("id",item.variation_id).eq("product_id",item.product_id).eq("establishment_id",cart.establishment_id).maybeSingle():Promise.resolve({data:null}),
    ]);
    if(!product?.active||item.variation_id&&!variation?.active) throw new Error(`${item.product_name} não está mais disponível.`);
    const addonIds=(item.selected_addons||[]).map((value:Record<string,unknown>)=>String(value.id));
    const {data:addons}=addonIds.length?await admin.from("addons").select("id,name,price_cents,active,addon_group_id").eq("establishment_id",cart.establishment_id).in("id",addonIds):{data:[]};
    const typedAddons=(addons||[]) as Array<{id:string;price_cents:number;active:boolean}>;
    if(typedAddons.some((addon:{active:boolean})=>!addon.active)) throw new Error(`Um adicional de ${item.product_name} não está mais disponível.`);
    const addonTotal=typedAddons.reduce((sum:number,addon:{id:string;price_cents:number})=>sum+addon.price_cents*Number((item.selected_addons||[]).find((value:Record<string,unknown>)=>value.id===addon.id)?.quantity||1),0);
    const unit=product.price_cents+Number(variation?.price_delta_cents||0)+addonTotal;
    subtotal+=unit*item.quantity;
    if(unit!==item.unit_price_cents) await admin.from("whatsapp_cart_items").update({product_name:product.name,variation_name:variation?.name||null,unit_price_cents:unit,total_cents:unit*item.quantity,updated_at:new Date().toISOString()}).eq("id",item.id);
  }
  let discount=0;
  if(cart.coupon_code) {
    const now=new Date().toISOString();
    const {data:coupon}=await admin.from("coupons").select("discount_type,discount_value,minimum_order_cents,usage_limit,uses_count,starts_at,ends_at,active").eq("establishment_id",cart.establishment_id).ilike("code",cart.coupon_code).maybeSingle();
    if(!coupon?.active||coupon.starts_at&&coupon.starts_at>now||coupon.ends_at&&coupon.ends_at<now||coupon.usage_limit!==null&&coupon.uses_count>=coupon.usage_limit||subtotal<coupon.minimum_order_cents) throw new Error("O cupom não é válido para este pedido.");
    discount=Math.min(subtotal,coupon.discount_type==="percentage"?Math.floor(subtotal*coupon.discount_value/100):coupon.discount_value);
  }
  let fee=0;
  if(cart.fulfillment_type==="delivery"&&cart.delivery_address?.neighborhood) {
    const {data:establishment}=await admin.from("establishments").select("slug").eq("id",cart.establishment_id).single();
    const {data:quote,error}=await admin.rpc("quote_public_delivery",{requested_slug:establishment?.slug,requested_neighborhood:cart.delivery_address.neighborhood,requested_subtotal_cents:Math.max(0,subtotal-discount)});
    if(error) throw error;
    fee=Number(quote.fee_cents||0);
  }
  const total=Math.max(0,subtotal-discount)+fee;
  await admin.from("whatsapp_carts").update({subtotal_cents:subtotal,discount_cents:discount,delivery_fee_cents:fee,total_cents:total,updated_at:new Date().toISOString()}).eq("id",cart.id);
  return {items:items||[],subtotal,discount,fee,total};
}

async function cartSummary(admin:Admin,cart:Cart,confirmation=false) {
  const totals=await recalculate(admin,cart);
  if(!totals.items.length) return "Seu carrinho está vazio. Diga o nome de um produto para começar.";
  const lines=totals.items.map((item:Record<string,unknown>,index:number)=>`${index+1}. ${item.quantity}× ${item.product_name}${item.variation_name?` (${item.variation_name})`:""} — ${money(Number(item.total_cents))}`);
  const values=[`Subtotal: ${money(totals.subtotal)}`,totals.discount?`Desconto: -${money(totals.discount)}`:"",totals.fee?`Entrega: ${money(totals.fee)}`:"",`Total: ${money(totals.total)}`].filter(Boolean).join("\n");
  const paymentLabels:Record<string,string>={cash:"Dinheiro",pix:"Pix",credit_card:"Crédito na entrega",debit_card:"Débito na entrega",mercado_pago_online:"Online pelo Mercado Pago",pagarme_online:"Online pelo Pagar.me"};
  const details=confirmation?`\n${cart.fulfillment_type==="delivery"?`Entrega: ${cart.delivery_address?.street}, ${cart.delivery_address?.number} · ${cart.delivery_address?.neighborhood}`:"Retirada no estabelecimento"}\nPagamento: ${paymentLabels[String(cart.payment_method)]||cart.payment_method}${cart.payment_method==="cash"?` · troco para ${money(Number(cart.cash_received_cents||0))}`:""}`:"";
  return `Seu pedido:\n${lines.join("\n")}\n${values}${details}${confirmation?"\n\nEnvie CONFIRMAR PEDIDO para concluir.":""}`;
}

function wantsOrder(text:string) { return /\b(novo pedido|repetir pedido|ultimo pedido|quero|pedir|comprar|adicionar|acrescentar|carrinho|finalizar pedido|fechar pedido)\b/.test(text)&&!/\b(meu pedido|status|andamento)\b/.test(text); }
function paymentFrom(text:string) {
  if(/\bdinheiro\b/.test(text)) return "cash";
  if(/\bpix\b/.test(text)) return "pix";
  if(/\b(cartao online|pagar online|online)\b/.test(text)) return "online_card";
  if(/\bcredito|cartao de credito\b/.test(text)) return "credit_card";
  if(/\bdebito|cartao de debito\b/.test(text)) return "debit_card";
  return null;
}

async function previewRepeatOrder(admin:Admin,cart:Cart,messageId:string) {
  const {data:last}=await admin.from("orders").select("id,order_number,created_at").eq("establishment_id",cart.establishment_id).eq("customer_phone",cart.customer_phone).eq("status","completed").order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(!last) return {cart,answer:"Ainda não encontrei um pedido entregue neste número. Diga o nome do produto que deseja."};
  const {data:oldItems}=await admin.from("order_items").select("product_id,product_name,quantity,addons,removed_ingredients,notes").eq("order_id",last.id).eq("establishment_id",cart.establishment_id);
  const ids=[...new Set((oldItems||[]).map((item:{product_id:string|null})=>item.product_id).filter(Boolean))] as string[];
  const {data:products}=ids.length?await admin.from("products").select("id,name,price_cents,active").eq("establishment_id",cart.establishment_id).in("id",ids):{data:[]};
  const active=new Map((products||[]).filter((product:{active:boolean})=>product.active).map((product:{id:string})=>[product.id,product]));
  const repeatItems=(oldItems||[]).filter((item:{product_id:string|null})=>item.product_id&&active.has(item.product_id)).map((item:{product_id:string;quantity:number;addons:unknown;removed_ingredients:unknown;notes:string|null})=>({product_id:item.product_id,quantity:item.quantity,selected_addons:Array.isArray(item.addons)?item.addons:[],removed_ingredients:Array.isArray(item.removed_ingredients)?item.removed_ingredients:[],notes:item.notes}));
  if(!repeatItems.length) return {cart,answer:"Os itens do seu último pedido não estão disponíveis agora. Posso mostrar o cardápio atualizado."};
  const unavailable=(oldItems||[]).length-repeatItems.length;
  cart=await changeCart(admin,cart,messageId,{state:"building_cart",status:"awaiting_confirmation",context:{repeat_items:repeatItems}} ,"repeat_previewed");
  const names=repeatItems.map((item:{product_id:string;quantity:number})=>`${item.quantity}× ${(active.get(item.product_id) as {name:string}).name}`);
  return {cart,answer:`Último pedido #${last.order_number}:\n${names.join("\n")}${unavailable?`\n${unavailable} item(ns) indisponível(is) foram retirados da repetição.`:""}\n\nOs preços e a disponibilidade serão recalculados agora. Envie REPETIR PEDIDO para colocar esses itens no carrinho.`};
}

export async function processConversationalOrder(input:ConversationOrderInput) : Promise<OrderReply> {
  const normalized=normalizeOrderText(input.text);
  const channel=input.channel||"whatsapp";
  const {data:crmContact}=channel==="voice"?{data:{customer_id:input.customerId||null}}:await input.admin.from("whatsapp_contacts").select("customer_id").eq("id",input.contactId).eq("establishment_id",input.establishmentId).maybeSingle();
  if(channel==="whatsapp"&&/\b(parar|parar mensagens|nao quero receber|nao quero mensagens|me tira da lista|sair da lista|cancelar notificacoes|nao me mande mais)\b/.test(normalized)) {
    await input.admin.rpc("set_customer_marketing_consent",{requested_establishment_id:input.establishmentId,requested_customer_id:crmContact?.customer_id||null,requested_contact_id:input.contactId,requested_status:"opted_out",requested_origin:"customer_message",requested_channel:"whatsapp",requested_evidence:{message_id:input.messageId}});
    return {handled:true,answer:"Pronto. Você não receberá mais mensagens promocionais. As atualizações necessárias do seu pedido atual continuam disponíveis.",intent:"marketing_opt_out",toolName:"optOutMarketing"};
  }
  if(channel==="whatsapp"&&/\b(quero receber promocoes|pode mandar promocoes|ativar promocoes|voltar a receber)\b/.test(normalized)) {
    await input.admin.rpc("set_customer_marketing_consent",{requested_establishment_id:input.establishmentId,requested_customer_id:crmContact?.customer_id||null,requested_contact_id:input.contactId,requested_status:"opted_in",requested_origin:"customer_message",requested_channel:"whatsapp",requested_evidence:{message_id:input.messageId}});
    return {handled:true,answer:"Consentimento registrado. Você poderá receber promoções da loja e pode cancelar quando quiser enviando PARAR.",intent:"marketing_opt_in",toolName:"optInMarketing"};
  }
  if(crmContact?.customer_id&&/\b(quantos pontos|meus pontos|saldo de pontos|fidelidade)\b/.test(normalized)) {
    const {data:balance}=await input.admin.rpc("get_loyalty_balance",{requested_establishment_id:input.establishmentId,requested_customer_id:crmContact.customer_id});
    return {handled:true,answer:`Seu saldo atual é de ${Number(balance||0)} ponto(s). Os benefícios são validados pelo sistema no momento do uso.`,intent:"loyalty_balance",toolName:"getLoyaltyBalance"};
  }
  if(crmContact?.customer_id&&/^[1-5]$/.test(normalized)) {
    const {data:pending}=await input.admin.from("crm_feedback").select("id,order_id").eq("establishment_id",input.establishmentId).eq("customer_id",crmContact.customer_id).is("answered_at",null).order("requested_at",{ascending:false}).limit(1).maybeSingle();
    if(pending) {
      const rating=Number(normalized); const needsHuman=rating<=3;
      await input.admin.from("crm_feedback").update({rating,needs_human_attention:needsHuman,answered_at:new Date().toISOString()}).eq("id",pending.id).eq("establishment_id",input.establishmentId);
      if(needsHuman&&channel==="whatsapp") await input.admin.from("whatsapp_conversations").update({human_controlled:true,status:"waiting"}).eq("id",input.conversationId).eq("establishment_id",input.establishmentId);
      return {handled:true,answer:needsHuman?"Obrigado por contar. Sinto muito que a experiência não tenha sido boa. A equipe foi avisada e vai priorizar a resolução.":"Obrigado pela avaliação ❤️ Ela ficou registrada para melhorar nosso atendimento.",intent:"satisfaction_rating",toolName:"saveFeedback",shouldHandoff:needsHuman};
    }
  }
  const shouldCreate=wantsOrder(normalized);
  let cart=await loadCart(input.admin,input,shouldCreate);
  if(!cart) return {handled:false};
  if(cart.recovery_sent_at) {
    await input.admin.from("whatsapp_carts").update({recovered_at:new Date().toISOString()}).eq("id",cart.id).is("recovered_at",null);
  }
  const upsell=(cart.context?.upsell_product||null) as Product|null;
  if(upsell&&/^(sim|quero|adicionar)$/.test(normalized)) {
    await input.admin.from("whatsapp_carts").update({context:{},upsell_accepted_count:Number(cart.upsell_accepted_count||0)+1}).eq("id",cart.id);
    cart={...cart,context:{},upsell_accepted_count:Number(cart.upsell_accepted_count||0)+1};
    const result=await beginProduct(input.admin,cart,input.messageId,upsell,1);
    return {handled:true,answer:result.answer,intent:"accept_upsell",toolName:"addProduct"};
  }
  if(upsell&&/^(nao|não|dispenso)$/.test(normalized)) {
    cart=await changeCart(input.admin,cart,input.messageId,{context:{},state:"building_cart",status:"active"},"upsell_declined");
    return {handled:true,answer:"Sem problema. Quer acrescentar outro item ou finalizar o pedido?",intent:"decline_upsell",toolName:"declineUpsell"};
  }
  if(cart.context?.repeat_items&&normalized==="repetir pedido") {
    await input.admin.from("whatsapp_cart_items").delete().eq("cart_id",cart.id).eq("establishment_id",cart.establishment_id);
    for(const item of cart.context.repeat_items as Array<Record<string,unknown>>) {
      const {data:product}=await input.admin.from("products").select("id,name,price_cents,active").eq("id",String(item.product_id)).eq("establishment_id",cart.establishment_id).eq("active",true).maybeSingle();
      if(!product) continue;
      const quantity=Number(item.quantity||1);
      await input.admin.from("whatsapp_cart_items").insert({establishment_id:cart.establishment_id,cart_id:cart.id,product_id:product.id,quantity,selected_addons:item.selected_addons||[],removed_ingredients:item.removed_ingredients||[],notes:item.notes||null,product_name:product.name,unit_price_cents:product.price_cents,total_cents:product.price_cents*quantity});
    }
    cart=await changeCart(input.admin,cart,input.messageId,{context:{},state:"building_cart",status:"active"},"repeat_confirmed");
    try { return {handled:true,answer:`Pedido anterior colocado no carrinho com os valores atuais.\n${await cartSummary(input.admin,cart)}`,intent:"repeat_order",toolName:"repeatLastOrder"}; }
    catch(error) { return {handled:true,answer:error instanceof Error?error.message:"Não foi possível repetir o pedido.",intent:"repeat_order",toolName:"repeatLastOrder"}; }
  }
  if(/\b(repetir pedido|ultimo pedido)\b/.test(normalized)) {
    const result=await previewRepeatOrder(input.admin,cart,input.messageId);
    return {handled:true,answer:result.answer,intent:"repeat_order",toolName:"previewLastOrder"};
  }
  if(/\b(atendente|humano|falar com alguem|equipe)\b/.test(normalized)) {
    await changeCart(input.admin,cart,input.messageId,{state:"human_support",status:"awaiting_information"},"human_handoff");
    return {handled:false};
  }
  if(/\b(cancelar pedido|abandonar pedido)\b/.test(normalized)) {
    await changeCart(input.admin,cart,input.messageId,{state:"completed",status:"abandoned",context:{}},"cart_abandoned");
    return {handled:true,answer:"Pedido cancelado. Quando quiser recomeçar, envie “novo pedido”.",intent:"cancel_order",toolName:"abandonCart"};
  }
  if(/\b(limpar|esvaziar)\b.*\b(carrinho|pedido)\b/.test(normalized)) {
    if((cart.context as Record<string,unknown>)?.confirm_clear) { await input.admin.from("whatsapp_cart_items").delete().eq("cart_id",cart.id); cart=await changeCart(input.admin,cart,input.messageId,{state:"browsing",status:"active",context:{}},"cart_cleared"); return {handled:true,answer:"Carrinho esvaziado. O que deseja pedir?",intent:"clear_cart",toolName:"clearCart"}; }
    cart=await changeCart(input.admin,cart,input.messageId,{context:{...cart.context,confirm_clear:true}},"clear_requested");
    return {handled:true,answer:"Quer mesmo apagar todos os itens? Envie “limpar carrinho” novamente para confirmar.",intent:"clear_cart",toolName:"confirmClearCart"};
  }
  if(/\b(ver|mostrar|resumo|meu)\b.*\b(carrinho|pedido)\b|^carrinho$/.test(normalized)) return {handled:true,answer:await cartSummary(input.admin,cart),intent:"view_cart",toolName:"getCart"};

  if(cart.state==="selecting_variant") {
    const pending=(cart.context.pending_item||{}) as Record<string,unknown>; const variations=(pending.variations||[]) as Array<Record<string,unknown>>;
    const index=Number(normalized.match(/\d+/)?.[0]||0)-1; const selected=variations[index]||variations.find(item=>normalizeOrderText(String(item.name))===normalized);
    if(!selected) return {handled:true,answer:`Escolha uma opção de 1 a ${variations.length}.`,intent:"select_variant",toolName:"selectVariation"};
    const next:Record<string,unknown>={...pending,variation_id:selected.id,variation_name:selected.name}; delete next.variations;
    cart=await changeCart(input.admin,cart,input.messageId,{context:{pending_item:next}},"variant_selected");
    const result=await askNextAddon(input.admin,cart,input.messageId);
    return {handled:true,answer:result.answer,intent:"select_variant",toolName:"selectVariation"};
  }
  if(cart.state==="selecting_addons") {
    const pending=(cart.context.pending_item||{}) as Record<string,unknown>; const groups=(pending.groups||[]) as Array<Record<string,unknown>>; const index=Number(pending.group_index||0); const group=groups[index]; const options=(group.addons||[]) as Array<Record<string,unknown>>;
    const picks=normalized==="0"||/\b(sem|nenhum|pular)\b/.test(normalized)?[]:[...normalized.matchAll(/\d+/g)].map(match=>Number(match[0])-1).filter(value=>value>=0&&value<options.length);
    const unique=[...new Set(picks)]; const min=Number(group.min_choices||0); const max=Number(group.max_choices||1);
    if(unique.length<min||unique.length>max) return {handled:true,answer:`Escolha de ${min} até ${max} opção(ões) usando os números.`,intent:"select_addons",toolName:"selectAddons"};
    const selected=unique.map(value=>({id:String(options[value].id),group_id:String(group.id),name:String(options[value].name),price_cents:Number(options[value].price_cents||0),quantity:1}));
    const next={...pending,addons:[...((pending.addons||[]) as unknown[]),...selected],group_index:index+1};
    cart=await changeCart(input.admin,cart,input.messageId,{context:{pending_item:next}},"addons_selected");
    const result=await askNextAddon(input.admin,cart,input.messageId);
    return {handled:true,answer:result.answer,intent:"select_addons",toolName:"selectAddons"};
  }

  const couponMatch=input.text.match(/(?:cupom|codigo)\s+([A-Za-z0-9_-]{2,30})/i);
  if(couponMatch) {
    cart=await changeCart(input.admin,cart,input.messageId,{coupon_code:couponMatch[1].toUpperCase()},"coupon_applied");
    try { return {handled:true,answer:`Cupom aplicado.\n${await cartSummary(input.admin,{...cart,coupon_code:couponMatch[1].toUpperCase()})}`,intent:"apply_coupon",toolName:"applyCoupon"}; }
    catch(error) { await input.admin.from("whatsapp_carts").update({coupon_code:null}).eq("id",cart.id); return {handled:true,answer:error instanceof Error?error.message:"Cupom inválido.",intent:"apply_coupon",toolName:"applyCoupon"}; }
  }

  if(cart.state==="asking_fulfillment") {
    if(/\b(entrega|delivery)\b/.test(normalized)) { cart=await changeCart(input.admin,cart,input.messageId,{fulfillment_type:"delivery",state:"collecting_address",status:"awaiting_information"},"fulfillment_selected"); return {handled:true,answer:"Envie o endereço assim: Rua e número, bairro, ponto de referência.\nEx.: Rua das Flores 125, Centro, portão azul",intent:"set_fulfillment",toolName:"setFulfillment"}; }
    if(/\b(retirada|retirar|buscar|balcao)\b/.test(normalized)) { cart=await changeCart(input.admin,cart,input.messageId,{fulfillment_type:"pickup",state:"selecting_payment",status:"awaiting_information"},"fulfillment_selected"); return {handled:true,answer:"Como deseja pagar? Pix, dinheiro, cartão de crédito ou débito.",intent:"set_fulfillment",toolName:"setFulfillment"}; }
    return {handled:true,answer:"Escolha ENTREGA ou RETIRADA.",intent:"set_fulfillment",toolName:"setFulfillment"};
  }
  if(cart.state==="collecting_address") {
    const address=parseDeliveryAddress(input.text);
    if(!address) return {handled:true,answer:"Não consegui confirmar o endereço. Envie no formato: Rua e número, bairro, ponto de referência.",intent:"set_address",toolName:"validateDelivery"};
    cart=await changeCart(input.admin,cart,input.messageId,{delivery_address:{...address,recipient_name:cart.customer_name},state:"validating_delivery",status:"awaiting_information"},"address_collected");
    try { const totals=await recalculate(input.admin,cart); cart=await changeCart(input.admin,cart,input.messageId,{state:"selecting_payment",status:"awaiting_information",delivery_fee_cents:totals.fee,total_cents:totals.total},"delivery_validated"); return {handled:true,answer:`Entrega disponível. Taxa: ${money(totals.fee)}. Total provisório: ${money(totals.total)}.\nComo deseja pagar? Pix, dinheiro, crédito ou débito.`,intent:"set_address",toolName:"validateDelivery"}; }
    catch(error) { cart=await changeCart(input.admin,cart,input.messageId,{state:"collecting_address",status:"awaiting_information"},"delivery_rejected"); return {handled:true,answer:error instanceof Error?error.message:"Endereço fora da área de entrega.",intent:"set_address",toolName:"validateDelivery"}; }
  }
  if(cart.state==="selecting_payment") {
    const method=paymentFrom(normalized);
    if(!method) return {handled:true,answer:"Escolha Pix, dinheiro, cartão de crédito ou débito.",intent:"set_payment",toolName:"setPayment"};
    const {data:modes}=await input.admin.from("service_modes").select("accepted_payment_methods").eq("establishment_id",cart.establishment_id).maybeSingle();
    const accepted=(modes?.accepted_payment_methods||[]) as string[];
    const acceptedAliases:Record<string,string[]>={credit_card:["credit_card","credit_on_delivery"],debit_card:["debit_card","debit_on_delivery"],online_card:["credit_card","credit_on_delivery","mercado_pago_online","pagarme_online"],pix:["pix","mercado_pago_online"],cash:["cash"]};
    if(accepted.length&&!acceptedAliases[method].some((value)=>accepted.includes(value))) return {handled:true,answer:"Essa forma de pagamento não está habilitada. Escolha uma das opções aceitas.",intent:"set_payment",toolName:"setPayment"};
    if(method==="cash") { cart=await changeCart(input.admin,cart,input.messageId,{payment_method:method,state:"collecting_change",status:"awaiting_information"},"payment_selected"); const totals=await recalculate(input.admin,cart); return {handled:true,answer:`O total é ${money(totals.total)}. Precisa de troco para quanto? Envie o valor, por exemplo 100,00.`,intent:"set_payment",toolName:"setPayment"}; }
    if(method==="pix") {
      const account=await hasActiveGateway(input.admin,cart.establishment_id,"mercado_pago");
      if(account) {
        cart=await changeCart(input.admin,cart,input.messageId,{payment_method:"mercado_pago_online",state:"collecting_pix_payer",status:"awaiting_information",context:{payment_kind:"pix",gateway_provider:"mercado_pago"}},"payment_selected");
        return {handled:true,answer:"Para gerar o Pix seguro e confirmar automaticamente, envie o e-mail e o CPF do pagador.\nEx.: cliente@email.com, 12345678901",intent:"set_payment",toolName:"setAutomaticPix"};
      }
    }
    if(method==="online_card") {
      const account=await hasActiveGateway(input.admin,cart.establishment_id);
      if(!account) return {handled:true,answer:"O pagamento online está indisponível agora. Escolha Pix, dinheiro ou cartão na entrega.",intent:"set_payment",toolName:"setPayment"};
      cart=await changeCart(input.admin,cart,input.messageId,{payment_method:`${account.provider}_online`,state:"final_confirmation",status:"awaiting_confirmation",context:{payment_kind:"hosted",gateway_provider:account.provider}},"payment_selected");
      return {handled:true,answer:`Você receberá um link seguro para pagar o cartão fora do WhatsApp. Não envie dados do cartão por aqui.\n${await cartSummary(input.admin,cart,true)}`,intent:"set_payment",toolName:"setHostedPayment"};
    }
    cart=await changeCart(input.admin,cart,input.messageId,{payment_method:method,state:"final_confirmation",status:"awaiting_confirmation"},"payment_selected");
    return {handled:true,answer:await cartSummary(input.admin,cart,true),intent:"set_payment",toolName:"setPayment"};
  }
  if(cart.state==="collecting_pix_payer") {
    const email=input.text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase();
    const cpf=input.text.replace(/\D/g,"").match(/\d{11}/)?.[0];
    if(!email||!cpf) return {handled:true,answer:"Envie um e-mail válido e os 11 números do CPF do pagador. Ex.: cliente@email.com, 12345678901",intent:"collect_pix_payer",toolName:"validatePixPayer"};
    cart=await changeCart(input.admin,cart,input.messageId,{state:"final_confirmation",status:"awaiting_confirmation",context:{...cart.context,payer_email:email,payer_cpf:cpf}},"pix_payer_collected");
    return {handled:true,answer:`Dados recebidos com segurança. O CPF não será exibido nas mensagens.\n${await cartSummary(input.admin,cart,true)}`,intent:"collect_pix_payer",toolName:"validatePixPayer"};
  }
  if(cart.state==="collecting_change") {
    const value=Number(normalized.replace(/[^0-9,.-]/g,"").replace(".","").replace(",",".")); const cents=Math.round(value*100); const totals=await recalculate(input.admin,cart);
    if(!Number.isFinite(cents)||cents<totals.total) return {handled:true,answer:`O valor precisa ser igual ou maior que ${money(totals.total)}.`,intent:"set_change",toolName:"calculateChange"};
    cart=await changeCart(input.admin,cart,input.messageId,{cash_received_cents:cents,state:"final_confirmation",status:"awaiting_confirmation"},"change_collected");
    return {handled:true,answer:`Troco: ${money(cents-totals.total)}.\n${await cartSummary(input.admin,cart,true)}`,intent:"set_change",toolName:"calculateChange"};
  }
  if(cart.state==="final_confirmation") {
    if(!/^(confirmar pedido|confirmo|confirmar|sim)$/.test(normalized)) return {handled:true,answer:`Para criar o pedido, envie exatamente CONFIRMAR PEDIDO.\n${await cartSummary(input.admin,cart,true)}`,intent:"confirm_order",toolName:"confirmOrder"};
    const {data:result,error}=channel==="voice"
      ? await input.admin.rpc("finalize_voice_cart",{requested_cart_id:cart.id,requested_confirmation_event_id:input.messageId})
      : channel==="web_chat"
        ? await input.admin.rpc("finalize_web_chat_cart",{requested_cart_id:cart.id,requested_confirmation_event_id:input.messageId})
        : await input.admin.rpc("finalize_whatsapp_cart",{requested_cart_id:cart.id,requested_confirmation_message_id:input.messageId});
    if(error) return {handled:true,answer:`Não foi possível concluir: ${error.message}. Seu carrinho foi mantido para tentar novamente.`,intent:"confirm_order",toolName:"createOfficialOrder"};
    const {data:establishment}=await input.admin.from("establishments").select("slug").eq("id",cart.establishment_id).single();
    const url=`${(process.env.NEXT_PUBLIC_SITE_URL||"").replace(/\/$/,"")}/loja/${establishment?.slug}?pedido=${result.tracking_token}`;
    if(String(cart.payment_method).endsWith("_online")) {
      try {
        const payment=await prepareWhatsAppPayment(input.admin,cart.establishment_id,result,cart.context||{});
        await input.admin.from("whatsapp_carts").update({context:{payment_kind:cart.context?.payment_kind,gateway_provider:cart.context?.gateway_provider}}).eq("id",cart.id);
        if(payment?.kind==="pix") return {handled:true,answer:`Pedido #${result.order_number} criado. A cozinha receberá após a confirmação automática do pagamento.\nTotal: ${money(result.total_cents)}\n\nPIX COPIA E COLA:\n${payment.code}\n\nVálido até ${new Date(payment.expiresAt).toLocaleString("pt-BR")}.\nAcompanhe: ${url}`,intent:"confirm_order",toolName:"createAutomaticPix"};
        if(payment?.kind==="hosted") return {handled:true,answer:`Pedido #${result.order_number} criado. Pague pelo link seguro abaixo; não envie dados do cartão no WhatsApp.\n${payment.url}\n\nA confirmação será automática. Acompanhe: ${url}`,intent:"confirm_order",toolName:"createHostedPayment"};
      } catch(paymentError) {
        return {handled:true,answer:`Pedido #${result.order_number} foi criado, mas não consegui abrir a cobrança agora: ${paymentError instanceof Error?paymentError.message:"falha temporária"}\nAcompanhe e tente novamente: ${url}`,intent:"confirm_order",toolName:"createOfficialOrder"};
      }
    }
    return {handled:true,answer:`Pedido #${result.order_number} criado e enviado para a cozinha.\nTotal: ${money(result.total_cents)}${result.cash_change_cents!==null&&result.cash_change_cents!==undefined?`\nTroco: ${money(result.cash_change_cents)}`:""}\nAcompanhe: ${url}`,intent:"confirm_order",toolName:"createOfficialOrder"};
  }

  if(/\b(finalizar|fechar|concluir)\b/.test(normalized)) {
    const {count}=await input.admin.from("whatsapp_cart_items").select("id",{count:"exact",head:true}).eq("cart_id",cart.id);
    if(!count) return {handled:true,answer:"Seu carrinho está vazio. Diga o nome do produto que deseja.",intent:"checkout",toolName:"getCart"};
    cart=await changeCart(input.admin,cart,input.messageId,{state:"asking_fulfillment",status:"awaiting_information"},"checkout_started");
    return {handled:true,answer:"O pedido será para ENTREGA ou RETIRADA?",intent:"checkout",toolName:"startCheckout"};
  }

  const removeMatch=normalized.match(/\bremover\s+(.+)/);
  if(removeMatch) {
    const {data:items}=await input.admin.from("whatsapp_cart_items").select("id,product_name").eq("cart_id",cart.id);
    const found=(items||[]).find((item:{product_name:string})=>normalizeOrderText(item.product_name).includes(removeMatch[1])||removeMatch[1].includes(normalizeOrderText(item.product_name)));
    if(!found) return {handled:true,answer:"Não encontrei esse item no carrinho.",intent:"remove_item",toolName:"removeCartItem"};
    await input.admin.from("whatsapp_cart_items").delete().eq("id",found.id).eq("cart_id",cart.id);
    await log(input.admin,cart,input.messageId,"item_removed",cart.state,"building_cart",{item_id:found.id});
    return {handled:true,answer:`${found.product_name} removido.\n${await cartSummary(input.admin,cart)}`,intent:"remove_item",toolName:"removeCartItem"};
  }

  const quantityMatch=normalized.match(/\b(?:alterar|mudar)\s+(.+?)\s+(?:para|quantidade)\s+(\d{1,3})\b/);
  if(quantityMatch) {
    const {data:items}=await input.admin.from("whatsapp_cart_items").select("id,product_name,unit_price_cents").eq("cart_id",cart.id);
    const found=(items||[]).find((item:{product_name:string})=>normalizeOrderText(item.product_name).includes(quantityMatch[1])); const quantity=Math.min(99,Math.max(1,Number(quantityMatch[2])));
    if(!found) return {handled:true,answer:"Não encontrei esse item no carrinho.",intent:"update_quantity",toolName:"updateCartQuantity"};
    await input.admin.from("whatsapp_cart_items").update({quantity,total_cents:found.unit_price_cents*quantity,updated_at:new Date().toISOString()}).eq("id",found.id).eq("cart_id",cart.id);
    return {handled:true,answer:`Quantidade de ${found.product_name} alterada para ${quantity}.\n${await cartSummary(input.admin,cart)}`,intent:"update_quantity",toolName:"updateCartQuantity"};
  }

  const pendingChoices=(cart.context?.product_choices||[]) as Array<Record<string,unknown>>;
  if(pendingChoices.length) {
    const index=Number(normalized.match(/^\d+$/)?.[0]||0)-1; const selected=pendingChoices[index];
    if(!selected) return {handled:true,answer:`Escolha um número de 1 a ${pendingChoices.length}.`,intent:"add_product",toolName:"selectProduct"};
    cart=await changeCart(input.admin,cart,input.messageId,{context:{}},"product_selected");
    const result=await beginProduct(input.admin,cart,input.messageId,selected as unknown as Product,parseOrderQuantity(input.text));
    return {handled:true,answer:result.answer,intent:"add_product",toolName:"addProduct"};
  }

  if(shouldCreate||cart.state==="browsing"||cart.state==="building_cart") {
    const {data:products}=await input.admin.from("products").select("id,name,price_cents,ingredients,active").eq("establishment_id",cart.establishment_id).eq("active",true).order("featured",{ascending:false}).limit(200);
    const cleaned=normalized.replace(/\b(quero|pedir|comprar|adicionar|acrescentar|coloca|por favor|me ve|manda|um|uma|dois|duas|tres|\d+|x)\b/g," ").replace(/\s+/g," ").trim();
    const exact=((products||[]) as Product[]).filter((product:Product)=>{const name=normalizeOrderText(product.name);return name===cleaned||normalized.includes(name)||name.includes(cleaned);});
    if(exact.length===1) { const result=await beginProduct(input.admin,cart,input.messageId,exact[0] as Product,parseOrderQuantity(input.text)); return {handled:true,answer:result.answer,intent:"add_product",toolName:"addProduct"}; }
    if(exact.length>1) {
      const choices=exact.slice(0,8); cart=await changeCart(input.admin,cart,input.messageId,{status:"awaiting_information",context:{product_choices:choices}},"product_ambiguous");
      return {handled:true,answer:`Encontrei mais de uma opção. Qual deseja?\n${choices.map((item:Product,index:number)=>`${index+1}. ${item.name} — ${money(item.price_cents)}`).join("\n")}`,intent:"add_product",toolName:"findProducts"};
    }
    return {handled:true,answer:"Não encontrei esse produto ativo. Envie o nome como aparece no cardápio, peça “ver cardápio” ou fale com a equipe.",intent:"add_product",toolName:"findProducts"};
  }
  return {handled:false};
}
