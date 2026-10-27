import { createHash } from "node:crypto";

export const MARKETING_PERMISSIONS = ["marketing:view","marketing:audience","marketing:promotion","marketing:campaign:create","marketing:campaign:approve","marketing:campaign:publish","marketing:campaign:pause","marketing:reports","marketing:override_margin"] as const;
export const OPPORTUNITY_TYPES = ["inactive_customer","high_value_low_frequency","repeat_purchase","high_margin_product","underperforming_product","excess_inventory","low_demand_period","birthday","loyalty","cross_sell","upsell","abandoned_cart","forecast_based","new_product","lapsed_category"] as const;
export const PROMOTION_TYPES = ["percentage","fixed","buy_x_get_y","free_delivery","free_item","bundle","bonus_points"] as const;
export const CHANNELS = ["whatsapp","web","push","email"] as const;

export type PromotionSimulationInput = { priceCents:number; unitCostCents?:number|null; discountType:"percentage"|"fixed"; discountValue:number; audienceSize:number; expectedOrders?:number|null; stockUnits?:number|null; capacityOrders?:number|null; fixedCostCents?:number; minMarginPercent?:number };
export function simulatePromotion(x:PromotionSimulationInput){
  const discount=x.discountType==="percentage"?Math.round(x.priceCents*Math.max(0,x.discountValue)/100):Math.max(0,Math.round(x.discountValue));
  const priceAfter=Math.max(0,x.priceCents-discount),cost=x.unitCostCents==null?null:Math.max(0,x.unitCostCents);
  const marginCents=cost==null?null:priceAfter-cost,marginPercent=cost==null||priceAfter===0?null:Number(((priceAfter-cost)/priceAfter*100).toFixed(2));
  const contribution=marginCents==null?null:marginCents,breakEvenOrders=contribution!=null&&contribution>0?Math.ceil(Math.max(0,x.fixedCostCents||0)/contribution):null;
  const risks:string[]=[];
  if(cost==null)risks.push("Custo ausente: margem e break-even não podem ser confirmados.");
  if(marginPercent!=null&&marginPercent<(x.minMarginPercent??0))risks.push("Margem abaixo do mínimo configurado.");
  if(x.expectedOrders==null)risks.push("Conversão não informada: nenhuma venda foi presumida.");
  if(x.expectedOrders!=null&&x.stockUnits!=null&&x.expectedOrders>x.stockUnits)risks.push("Estoque projetado insuficiente.");
  if(x.expectedOrders!=null&&x.capacityOrders!=null&&x.expectedOrders>x.capacityOrders)risks.push("Capacidade operacional insuficiente.");
  return{audienceSize:Math.max(0,x.audienceSize),priceAfterCents:priceAfter,discountCents:discount,marginCents,marginPercent,breakEvenOrders,expectedOrders:x.expectedOrders??null,stockUnits:x.stockUnits??null,capacityOrders:x.capacityOrders??null,eligible:!risks.some(r=>/abaixo|insuficiente/.test(r)),risks,classification:x.expectedOrders==null?"simulation_without_conversion":"operator_assumption"};
}

export function promotionValidation(input:{startsAt?:string|null;endsAt?:string|null;channels:string[];audienceSize:number;products:number;usageLimit?:number|null;stacking:string;simulation:ReturnType<typeof simulatePromotion>;override?:boolean;overrideReason?:string;lossLeader?:boolean}){
  const errors:string[]=[],warnings:string[]=[];
  if(input.startsAt&&input.endsAt&&Date.parse(input.endsAt)<=Date.parse(input.startsAt))errors.push("Período inválido.");
  if(!input.channels.length)errors.push("Selecione ao menos um canal.");
  if(input.audienceSize<1)errors.push("O público está vazio.");
  if(input.products<1)errors.push("Selecione produtos elegíveis.");
  if(input.usageLimit!=null&&input.usageLimit<1)errors.push("O limite de uso deve ser positivo.");
  if(!["exclusive","combinable","best_benefit"].includes(input.stacking))errors.push("Regra de acumulação inválida.");
  if(input.simulation.marginPercent==null)errors.push("Margem indisponível por falta de custo.");
  if(!input.simulation.eligible&&!input.override)errors.push("A promoção viola uma proteção operacional ou de margem.");
  if(input.override&&!input.overrideReason?.trim())errors.push("Justificativa obrigatória para override.");
  if(input.lossLeader&&!input.override)errors.push("Loss leader exige permissão e override explícito.");
  warnings.push(...input.simulation.risks);
  return{valid:errors.length===0,errors,warnings,requiresApproval:Boolean(input.override||input.lossLeader)};
}

export function rfmScore(customers:Array<{id:string;lastOrderAt?:string|null;orders:number;spentCents:number}>,now=Date.now()){
  if(!customers.length)return[];
  const quantile=(values:number[],value:number)=>Math.max(1,Math.min(5,Math.ceil((values.filter(v=>v<=value).length/values.length)*5)));
  const recencies=customers.map(c=>c.lastOrderAt?Math.max(0,Math.floor((now-Date.parse(c.lastOrderAt))/86400000)):3650),frequencies=customers.map(c=>c.orders),monetaries=customers.map(c=>c.spentCents);
  return customers.map((c,i)=>({customerId:c.id,recency:6-quantile(recencies.map(v=>-v),-recencies[i]),frequency:quantile(frequencies,c.orders),monetary:quantile(monetaries,c.spentCents)}));
}

export function audienceEligibility(input:{consent:string;channel:string;channelOptOut?:boolean;blocked?:boolean;complaint?:boolean;messages7d:number;cap7d:number;lastPromotionalAt?:string|null;minIntervalHours:number;now?:number}){
  const reasons:string[]=[],now=input.now??Date.now();
  if(input.consent!=="opted_in")reasons.push("sem consentimento explícito");
  if(input.channelOptOut)reasons.push(`opt-out em ${input.channel}`);
  if(input.blocked)reasons.push("contato bloqueado");
  if(input.complaint)reasons.push("reclamação ou supressão ativa");
  if(input.messages7d>=input.cap7d)reasons.push("limite de frequência atingido");
  if(input.lastPromotionalAt&&now-Date.parse(input.lastPromotionalAt)<input.minIntervalHours*3600000)reasons.push("intervalo mínimo não atingido");
  return{eligible:reasons.length===0,reasons};
}

export function isQuietHours(date:Date,start="21:00",end="08:00",timeZone="America/Sao_Paulo"){
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone,hour:"2-digit",minute:"2-digit",hour12:false}).format(date).split(":").map(Number),minutes=parts[0]*60+parts[1];
  const parse=(s:string)=>{const[h,m]=s.split(":").map(Number);return h*60+m},a=parse(start),b=parse(end);
  return a>b?minutes>=a||minutes<b:minutes>=a&&minutes<b;
}
export function deterministicAssignment(subjectId:string,experimentId:string,controlPercent=10){const n=parseInt(createHash("sha256").update(`${experimentId}:${subjectId}`).digest("hex").slice(0,8),16)%100;return n<controlPercent?"control":n<(100+controlPercent)/2?"A":"B"}
export function experimentResult(input:{variantOrders:number;variantAudience:number;controlOrders:number;controlAudience:number;minimumSample:number}){const sufficient=input.variantAudience>=input.minimumSample&&input.controlAudience>=input.minimumSample,vr=input.variantAudience?input.variantOrders/input.variantAudience:null,cr=input.controlAudience?input.controlOrders/input.controlAudience:null;return{sufficient,variantRate:sufficient?vr:null,controlRate:sufficient?cr:null,uplift:sufficient&&vr!=null&&cr!=null&&cr>0?(vr-cr)/cr:null,label:sufficient?"resultado descritivo":"amostra insuficiente"}}
export function attributionSummary(rows:Array<{revenueCents:number;marginCents?:number|null;costCents?:number|null;paidMediaCents?:number|null}>,incremental?:{variant:number;control:number;sufficient:boolean}){const revenue=rows.reduce((s,r)=>s+r.revenueCents,0),margin=rows.some(r=>r.marginCents!=null)?rows.reduce((s,r)=>s+(r.marginCents||0),0):null,cost=rows.some(r=>r.costCents!=null)?rows.reduce((s,r)=>s+(r.costCents||0),0):null,paid=rows.some(r=>r.paidMediaCents!=null)?rows.reduce((s,r)=>s+(r.paidMediaCents||0),0):null;return{attributedRevenueCents:revenue,attributedMarginCents:margin,incrementalRevenueCents:incremental?.sufficient?incremental.variant-incremental.control:null,roi:cost!=null&&cost>0?(revenue-cost)/cost:null,roas:paid!=null&&paid>0?revenue/paid:null,disclaimer:"Atribuição não prova causalidade; incrementalidade exige grupo de controle e amostra suficiente."}}

export class MarketingOpportunityEngine{
  detect(input:{customers:Array<any>;products:Array<any>;lowDemandWindows?:Array<any>;inventory?:Array<any>;minimumSample:number}){const out:any[]=[];const inactive=input.customers.filter(c=>c.status==="inactive");if(inactive.length>=input.minimumSample)out.push({type:"inactive_customer",title:"Reativar clientes inativos",audienceSize:inactive.length,explanation:"Clientes acima da janela de inatividade configurada.",risk:"Respeitar consentimento, frequência e reclamações."});const highMargin=input.products.filter(p=>p.costStatus==="complete"&&p.marginPercent>=p.targetMarginPercent&&p.orders>0);if(highMargin.length)out.push({type:"high_margin_product",title:"Promover itens com margem conhecida",audienceSize:null,explanation:`${highMargin.length} produto(s) com custo completo e margem acima da meta.`,risk:"Validar capacidade, estoque e canibalização."});for(const w of input.lowDemandWindows||[])out.push({type:"low_demand_period",title:`Demanda baixa em ${w.label}`,audienceSize:w.audienceSize??null,explanation:"Janela observada ou prevista abaixo do baseline.",risk:"Previsão pode ter baixa confiança; revisar intervalo."});return out}}
export class PromotionValidationService{validate=promotionValidation}

export function marketingCopilot(tool:string,context:any){switch(tool){case"getMarketingOpportunities":return new MarketingOpportunityEngine().detect(context);case"getBestAudienceForProduct":return{productId:context.productId,candidates:context.segments||[],recommendation:"Compare tamanho, afinidade, consentimento e fadiga; a escolha permanece humana."};case"getCampaignProfitability":return attributionSummary(context.rows||[],context.incremental);case"getInactiveCustomerSegments":return(context.segments||[]).filter((x:any)=>/inativ|risco|lapsed/i.test(`${x.name} ${x.type}`));case"getHighMarginPromotionCandidates":return(context.products||[]).filter((x:any)=>x.costStatus==="complete"&&x.marginPercent>=x.targetMarginPercent);case"getLowDemandWindows":return(context.windows||[]).filter((x:any)=>x.classification==="low"||x.expectedOrders<x.baselineOrders);case"getCampaignAttribution":return attributionSummary(context.rows||[],context.incremental);case"simulatePromotion":return simulatePromotion(context);default:throw new Error("Ferramenta de marketing não suportada.")}}
