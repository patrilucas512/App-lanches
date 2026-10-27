import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttendantIntent, AvailableTool, ToolResult } from "./types";

const money = (value: number | null | undefined) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format((value || 0) / 100);
const paymentLabels: Record<string,string> = { pix:"Pix", cash:"dinheiro", credit_card:"cartão de crédito", debit_card:"cartão de débito", credit_on_delivery:"crédito na entrega", debit_on_delivery:"débito na entrega", online:"pagamento on-line" };
const orderLabels: Record<string,string> = { new:"recebido", confirmed:"confirmado", preparing:"em preparo", ready:"pronto", out_for_delivery:"saiu para entrega", completed:"entregue", canceled:"cancelado" };

export const availableTools: AvailableTool[] = [
  { name:"getBusinessStatus", description:"horário, aberto ou fechado, contato e endereço" },
  { name:"getDeliveryInfo", description:"entrega, bairros, taxas e prazos" },
  { name:"getMenu", description:"link, categorias e produtos ativos" },
  { name:"searchProducts", description:"preço, disponibilidade, variações e adicionais" },
  { name:"getPaymentMethods", description:"formas de pagamento aceitas" },
  { name:"getPromotions", description:"promoções ativas" },
  { name:"getOrderStatus", description:"último pedido associado ao WhatsApp" },
  { name:"getCustomerSubscriptions", description:"plano, status e próxima renovação do cliente" },
  { name:"getSubscriptionBenefits", description:"benefícios estruturados incluídos no plano" },
  { name:"getSubscriptionUsage", description:"uso e limites dos benefícios" },
  { name:"requestSubscriptionCancellation", description:"inicia cancelamento com confirmação explícita no portal" },
  { name:"getReservationAvailability", description:"consulta horários e mesas disponíveis no backend" },
  { name:"createReservation", description:"cria somente após resumo e confirmação explícita" },
  { name:"rescheduleReservation", description:"valida novo horário antes de trocar" },
  { name:"cancelReservation", description:"aplica política de cancelamento da unidade" },
  { name:"getReservation", description:"consulta reserva ligada ao WhatsApp" },
  { name:"joinWaitlist", description:"entra na fila real com idempotência" },
  { name:"getWaitlistStatus", description:"consulta posição e estimativa reais" },
  { name:"checkInReservation", description:"registra chegada quando permitido" },
  { name:"requestHumanSupport", description:"transferência para atendimento humano" },
];

type ToolContext = { admin: SupabaseClient; establishmentId: string; waId: string; query: string; attendantName: string; humanHandoffEnabled: boolean };

async function businessData(context: ToolContext) {
  const [establishment, settings, hours, modes] = await Promise.all([
    context.admin.from("establishments").select("name,slug,phone,email,active").eq("id",context.establishmentId).single(),
    context.admin.from("establishment_settings").select("timezone,whatsapp,instagram,address,estimated_minutes,pickup_enabled,delivery_enabled").eq("establishment_id",context.establishmentId).single(),
    context.admin.from("business_hours").select("weekday,opens_at,closes_at,closed").eq("establishment_id",context.establishmentId).order("weekday"),
    context.admin.from("service_modes").select("store_open,counter_pickup_enabled,takeaway_enabled,delivery_enabled,accepted_payment_methods").eq("establishment_id",context.establishmentId).maybeSingle(),
  ]);
  return { establishment:establishment.data, settings:settings.data, hours:hours.data || [], modes:modes.data };
}

function localDayTime(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone:timezone, weekday:"short", hour:"2-digit", minute:"2-digit", hourCycle:"h23" }).formatToParts(new Date());
  const weekday = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(parts.find((p)=>p.type==="weekday")?.value || "Sun");
  return { weekday, time:`${parts.find((p)=>p.type==="hour")?.value || "00"}:${parts.find((p)=>p.type==="minute")?.value || "00"}:00` };
}

function formatAddress(address: unknown) {
  const item = (address && typeof address === "object" ? address : {}) as Record<string,unknown>;
  const line = [item.street || item.address, item.number].filter(Boolean).join(", ");
  return [line, item.neighborhood, item.city, item.state].filter(Boolean).join(" · ");
}

async function getBusinessStatus(context: ToolContext, detail: "hours"|"contact"|"pickup"|"greeting"): Promise<ToolResult> {
  const data = await businessData(context);
  if (!data.establishment || !data.settings) return { ok:false, toolName:"getBusinessStatus", answer:"Não consegui consultar os dados do estabelecimento.", shouldHandoff:true };
  if (detail === "greeting") return { ok:true, toolName:"getBusinessStatus", answer:`Olá! Eu sou ${context.attendantName}, atendente virtual de ${data.establishment.name}. Posso consultar cardápio, preços, horários, entrega e o andamento do seu pedido.` };
  if (detail === "contact") {
    const address = formatAddress(data.settings.address);
    const contact = data.establishment.phone || data.settings.whatsapp;
    const details = [address && `Endereço: ${address}.`, contact && `Contato: ${contact}.`, data.settings.instagram && `Instagram: ${data.settings.instagram}.`].filter(Boolean);
    return details.length ? { ok:true, toolName:"getBusinessStatus", answer:details.join(" ") } : { ok:false, toolName:"getBusinessStatus", answer:"O endereço e o contato ainda não foram cadastrados.", shouldHandoff:true };
  }
  if (detail === "pickup") {
    const enabled = Boolean(data.modes?.counter_pickup_enabled || data.modes?.takeaway_enabled || data.settings.pickup_enabled);
    return { ok:true, toolName:"getBusinessStatus", answer:enabled ? `Sim, há retirada no estabelecimento. O prazo base informado é de cerca de ${data.settings.estimated_minutes || 45} minutos.` : "A retirada não está habilitada no momento." };
  }
  const timezone = data.settings.timezone || "America/Sao_Paulo";
  const now = localDayTime(timezone);
  const today = data.hours.find((row: {weekday:number})=>row.weekday===now.weekday) as {closed:boolean;opens_at:string|null;closes_at:string|null}|undefined;
  const scheduledOpen = Boolean(today && !today.closed && today.opens_at && today.closes_at && now.time >= today.opens_at && now.time <= today.closes_at);
  const open = data.modes?.store_open !== false && scheduledOpen;
  const schedule = today?.closed ? "Hoje não há atendimento." : today?.opens_at && today?.closes_at ? `Hoje: ${today.opens_at.slice(0,5)} às ${today.closes_at.slice(0,5)}.` : "O horário de hoje não foi cadastrado.";
  return { ok:true, toolName:"getBusinessStatus", answer:`A loja está ${open ? "aberta" : "fechada"} agora. ${schedule}` };
}

async function getDeliveryInfo(context: ToolContext): Promise<ToolResult> {
  const [settings,modes,zones,base] = await Promise.all([
    context.admin.from("delivery_settings").select("fee_model,fixed_fee_cents,free_delivery_above_cents,service_city,service_state").eq("establishment_id",context.establishmentId).maybeSingle(),
    context.admin.from("service_modes").select("delivery_enabled,store_open").eq("establishment_id",context.establishmentId).maybeSingle(),
    context.admin.from("delivery_zones").select("name,fee_cents,minimum_order_cents,free_delivery_above_cents,estimated_minutes").eq("establishment_id",context.establishmentId).eq("active",true).order("name").limit(20),
    context.admin.from("establishment_settings").select("estimated_minutes").eq("establishment_id",context.establishmentId).single(),
  ]);
  if (!modes.data?.delivery_enabled) return { ok:true, toolName:"getDeliveryInfo", answer:"A entrega não está habilitada no momento." };
  const fixed = settings.data?.fee_model === "fixed" ? `Taxa: ${money(settings.data.fixed_fee_cents)}.` : "A taxa varia conforme o bairro.";
  const region = [settings.data?.service_city,settings.data?.service_state].filter(Boolean).join("/");
  const zoneText = (zones.data || []).map((z:Record<string,any>)=>`${z.name}: ${money(z.fee_cents)}, cerca de ${z.estimated_minutes || base.data?.estimated_minutes || 45} min`).join("; ");
  const free = settings.data?.free_delivery_above_cents ? ` Entrega grátis acima de ${money(settings.data.free_delivery_above_cents)}.` : "";
  return { ok:true, toolName:"getDeliveryInfo", answer:`${fixed}${free}${region ? ` Região principal: ${region}.` : ""}${zoneText ? ` Bairros cadastrados — ${zoneText}.` : ` Prazo base: cerca de ${base.data?.estimated_minutes || 45} minutos.`}` };
}

async function getMenu(context: ToolContext, categoriesOnly=false): Promise<ToolResult> {
  const [establishment,categories] = await Promise.all([
    context.admin.from("establishments").select("slug").eq("id",context.establishmentId).single(),
    context.admin.from("categories").select("name").eq("establishment_id",context.establishmentId).eq("active",true).order("sort_order").limit(20),
  ]);
  const names=(categories.data||[]).map((item:Record<string,any>)=>item.name);
  const base=(process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/,"");
  const link=establishment.data?.slug ? `${base}/loja/${establishment.data.slug}` : "";
  if (categoriesOnly) return { ok:true, toolName:"getMenu", answer:names.length ? `Categorias disponíveis: ${names.join(", ")}. ${link ? `Cardápio: ${link}`:""}` : "Não há categorias ativas no momento." };
  return link ? { ok:true, toolName:"getMenu", answer:`Veja o cardápio atualizado aqui: ${link}${names.length ? `\nCategorias: ${names.join(", ")}.`:""}` } : { ok:false, toolName:"getMenu", answer:"O link do cardápio não está disponível agora.", shouldHandoff:true };
}

async function searchProducts(context: ToolContext): Promise<ToolResult> {
  if (context.query.length < 2) return getMenu(context,false);
  const { data: products } = await context.admin.from("products").select("id,name,description,price_cents,compare_at_price_cents,active,categories(name)").eq("establishment_id",context.establishmentId).eq("active",true).ilike("name",`%${context.query.replace(/[%_,]/g,"")}%`).order("featured",{ascending:false}).limit(5);
  if (!products?.length) return { ok:true, toolName:"searchProducts", answer:`Não encontrei “${context.query}” entre os produtos ativos. Posso mostrar o cardápio completo ou chamar uma pessoa da equipe.` };
  const ids=products.map((p:Record<string,any>)=>p.id);
  const [variations,links] = await Promise.all([
    context.admin.from("product_variations").select("product_id,name,price_delta_cents").eq("establishment_id",context.establishmentId).in("product_id",ids).eq("active",true).order("sort_order"),
    context.admin.from("product_addon_groups").select("product_id,addon_group_id").eq("establishment_id",context.establishmentId).in("product_id",ids),
  ]);
  const groupIds=[...new Set((links.data||[]).map((item:Record<string,any>)=>String(item.addon_group_id)))];
  const { data:addons }=groupIds.length ? await context.admin.from("addons").select("addon_group_id,name,price_cents").eq("establishment_id",context.establishmentId).in("addon_group_id",groupIds).eq("active",true).order("sort_order") : {data:[]};
  const lines=products.map((product:Record<string,any>)=>{
    const vars=(variations.data||[]).filter((v:Record<string,any>)=>v.product_id===product.id).map((v:Record<string,any>)=>`${v.name}${v.price_delta_cents ? ` (+${money(v.price_delta_cents)})`:""}`);
    const linkedGroups=(links.data||[]).filter((l:Record<string,any>)=>l.product_id===product.id).map((l:Record<string,any>)=>String(l.addon_group_id));
    const extras=(addons||[]).filter((a:Record<string,any>)=>linkedGroups.includes(String(a.addon_group_id))).slice(0,5).map((a:Record<string,any>)=>`${a.name} (+${money(a.price_cents)})`);
    return `• ${product.name} — ${money(product.price_cents)}${vars.length ? `. Variações: ${vars.join(", ")}`:""}${extras.length ? `. Adicionais: ${extras.join(", ")}`:""}`;
  });
  return { ok:true, toolName:"searchProducts", answer:lines.join("\n") };
}

async function getPaymentMethods(context: ToolContext): Promise<ToolResult> {
  const [settings,modes] = await Promise.all([
    context.admin.from("establishment_settings").select("payment_methods").eq("establishment_id",context.establishmentId).single(),
    context.admin.from("service_modes").select("accepted_payment_methods").eq("establishment_id",context.establishmentId).maybeSingle(),
  ]);
  const methods = (modes.data?.accepted_payment_methods || settings.data?.payment_methods || []) as string[];
  return { ok:true, toolName:"getPaymentMethods", answer:methods.length ? `Formas de pagamento aceitas: ${methods.map((item)=>paymentLabels[item]||item).join(", ")}.` : "As formas de pagamento ainda não foram cadastradas." };
}

async function getPromotions(context: ToolContext): Promise<ToolResult> {
  const now=new Date().toISOString();
  const { data }=await context.admin.from("banners").select("title,subtitle,promotion_type,promotion_value").eq("establishment_id",context.establishmentId).eq("active",true).or(`starts_at.is.null,starts_at.lte.${now}`).or(`ends_at.is.null,ends_at.gte.${now}`).order("sort_order").limit(10);
  if (!data?.length) return { ok:true, toolName:"getPromotions", answer:"Não há promoção ativa cadastrada no momento." };
  return { ok:true, toolName:"getPromotions", answer:`Promoções ativas:\n${data.map((item:Record<string,any>)=>`• ${item.title}${item.subtitle ? ` — ${item.subtitle}`:""}`).join("\n")}` };
}

async function getOrderStatus(context: ToolContext): Promise<ToolResult> {
  const phone=context.waId.replace(/\D/g,"");
  const { data:customer }=await context.admin.from("customers").select("id").eq("establishment_id",context.establishmentId).eq("phone",phone).maybeSingle();
  let query=context.admin.from("orders").select("id,order_number,status,fulfillment_type,total_cents,created_at,estimated_arrival_at").eq("establishment_id",context.establishmentId);
  query=customer?.id ? query.eq("customer_id",customer.id) : query.eq("customer_phone",phone);
  const { data:order }=await query.order("created_at",{ascending:false}).limit(1).maybeSingle();
  if (!order) return { ok:true, toolName:"getOrderStatus", answer:"Não encontrei um pedido recente ligado a este número. Se você usou outro telefone, envie o número do pedido ou peça atendimento humano." };
  const eta=order.estimated_arrival_at ? ` Previsão registrada: ${new Date(order.estimated_arrival_at).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})}.` : "";
  return { ok:true, toolName:"getOrderStatus", answer:`Pedido #${order.order_number}: ${orderLabels[order.status] || order.status}. Total ${money(order.total_cents)}.${eta}` };
}

async function getSubscriptions(context:ToolContext):Promise<ToolResult>{
  const{data,error}=await context.admin.rpc("get_customer_subscription_tools",{requested_establishment_id:context.establishmentId,requested_phone:context.waId});
  if(error||!data?.subscriptions?.length)return{ok:true,toolName:"getCustomerSubscriptions",answer:"Não encontrei uma assinatura ligada a este número. Você pode consultar ou contratar um plano em Minha Conta."};
  const base=(process.env.NEXT_PUBLIC_SITE_URL||"").replace(/\/$/,"");const{data:store}=await context.admin.from("establishments").select("slug").eq("id",context.establishmentId).single();const portal=store?.slug?`${base}/conta/${store.slug}`:"Minha Conta";
  const wantsCancel=/cancel/i.test(context.query);const lines=(data.subscriptions as Array<Record<string,any>>).map(item=>{const benefits=(item.benefits||[]).map((b:Record<string,any>)=>b.name).filter(Boolean).slice(0,6);return `• ${item.plan}: ${item.status}. ${item.next_billing_at?`Próxima cobrança em ${new Date(item.next_billing_at).toLocaleDateString("pt-BR")}.`:item.current_period_end?`Ciclo válido até ${new Date(item.current_period_end).toLocaleDateString("pt-BR")}.`:""}${benefits.length?` Benefícios: ${benefits.join(", ")}.`:""}`}).join("\n");
  return{ok:true,toolName:wantsCancel?"requestSubscriptionCancellation":"getCustomerSubscriptions",answer:wantsCancel?`${lines}\nPara sua segurança, o cancelamento exige uma confirmação explícita. Abra ${portal}, entre em Assinaturas, confira a data de encerramento e confirme.`:`${lines}\nGerencie com segurança em ${portal}.`};
}

async function getReservations(context:ToolContext):Promise<ToolResult>{
 const{data,error}=await context.admin.rpc("get_reservation_ai_context",{requested_establishment_id:context.establishmentId,requested_phone:context.waId});if(error)return{ok:false,toolName:"getReservation",answer:"Não consegui consultar as reservas agora.",shouldHandoff:true};
 const reservations=(data?.reservations||[])as Array<Record<string,any>>;const queue=(data?.waitlist||[])as Array<Record<string,any>>;const base=(process.env.NEXT_PUBLIC_SITE_URL||"").replace(/\/$/,"");const{data:store}=await context.admin.from("establishments").select("slug").eq("id",context.establishmentId).single();const portal=store?.slug?`${base}/conta/${store.slug}`:"Minha Conta";
 if(/fila|quanto falta|posicao/.test(context.query)){if(!queue.length)return{ok:true,toolName:"getWaitlistStatus",answer:`Você não está em uma fila ativa. Para entrar com segurança, acesse ${portal}.`};const w=queue[0];return{ok:true,toolName:"getWaitlistStatus",answer:`Sua posição atual é ${w.position}. A espera estimada é de ${w.estimated_wait_minutes} minutos; é uma estimativa baseada na ocupação real.`};}
 if(/cancel|reagend|alterar|check.?in/.test(context.query))return{ok:true,toolName:/cancel/.test(context.query)?"cancelReservation":/reagend|alterar/.test(context.query)?"rescheduleReservation":"checkInReservation",answer:`Essa ação precisa validar a política, a disponibilidade e uma confirmação explícita. Faça pelo portal seguro: ${portal}.`};
 if(!reservations.length)return{ok:true,toolName:"getReservation",answer:`Não encontrei reserva ligada a este número. Consulte horários ou faça uma nova reserva em ${portal}.`};
 const r=reservations[0];return{ok:true,toolName:"getReservation",answer:`Reserva ${r.code}: ${new Date(r.starts_at).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})}, ${r.party_size} pessoa(s), status ${String(r.status).replaceAll("_"," ")}. Gerencie em ${portal}.`};
}

export async function executeMasterAppTool(intent: AttendantIntent, context: ToolContext): Promise<ToolResult> {
  switch(intent) {
    case "greeting": return getBusinessStatus(context,"greeting");
    case "hours": return getBusinessStatus(context,"hours");
    case "contact": return getBusinessStatus(context,"contact");
    case "pickup": return getBusinessStatus(context,"pickup");
    case "delivery": return getDeliveryInfo(context);
    case "menu": return getMenu(context,false);
    case "categories": return getMenu(context,true);
    case "availability": case "product_search": return searchProducts(context);
    case "payment_methods": return getPaymentMethods(context);
    case "promotions": return getPromotions(context);
    case "order_status": return getOrderStatus(context);
    case "subscriptions": return getSubscriptions(context);
    case "reservations": return getReservations(context);
    case "human_handoff": return { ok:true, toolName:"requestHumanSupport", answer:"Vou transferir seu atendimento para uma pessoa da equipe. Aguarde um instante.", shouldHandoff:true };
    default: return { ok:false, toolName:"requestHumanSupport", answer:"Não consegui identificar o que você precisa com segurança.", shouldHandoff:context.humanHandoffEnabled };
  }
}

