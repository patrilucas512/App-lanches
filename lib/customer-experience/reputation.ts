/* eslint-disable @typescript-eslint/no-explicit-any */
/* Reputation and root-cause links. Findings always carry volume and period and say that correlation is not causation. Staff is never ranked. */
import {CORRELATION_NOTICE,ExperienceMetricsService,IMPORTED_SOURCES,isDetractor,summarizeFacts} from "./core.ts";

const isoDate=(value:number)=>new Date(value).toISOString().slice(0,10);
export const periodOf=(days:number,now=Date.now())=>({from:isoDate(now-(days-1)*864e5),to:isoDate(now)});

export class ReputationService{
  byScope(rows:any[],input:{minimumSample:number;stores:Array<{id:string;name:string;network_brand_id?:string|null;brand_name?:string|null}>}){
    const scope=(list:any[])=>summarizeFacts(list,input.minimumSample),brands=new Map<string,string>();
    for(const store of input.stores)if(store.network_brand_id)brands.set(store.network_brand_id,store.brand_name||store.network_brand_id);
    return{
      network:scope(rows),
      stores:input.stores.map(store=>({storeId:store.id,name:store.name,...scope(rows.filter(x=>x.store_id===store.id))})),
      brands:[...brands].map(([id,name])=>{const ids=new Set(input.stores.filter(x=>x.network_brand_id===id).map(x=>x.id));return{brandId:id,name,...scope(rows.filter(x=>ids.has(x.store_id)))}}),
    };
  }
  // A drop only counts when both periods clear the minimum sample, otherwise noise would look like a crisis.
  npsTrend(input:{current:any;previous:any;dropPoints:number}){
    if(input.current.status!=="ok"||input.previous.status!=="ok")return{status:"insufficient_sample",change:null,drop:false,responses:{current:input.current.responses,previous:input.previous.responses}};
    const change=input.current.value-input.previous.value;
    return{status:"ok",change,drop:change<=-Math.abs(input.dropPoints),responses:{current:input.current.responses,previous:input.previous.responses}};
  }
}

const SHIFT=(hour:number)=>hour<11?"manhã":hour<15?"almoço":hour<18?"tarde":"jantar";
const round=(value:number,digits=1)=>Math.round(value*10**digits)/10**digits;
const negativeOf=(row:any,topic:string)=>(row.topics||[]).some((x:any)=>x.topic_key===topic&&x.polarity==="negative");

export class RootCauseLinkService{
  // Input rows are feedback joined to order facts. There is no courier or employee field here, so this cannot rank a person.
  analyze(input:{rows:any[];minimumSample:number;period:{from:string;to:string};delayMinutes?:number}){
    const findings:any[]=[],{rows,minimumSample,period}=input,cut=input.delayMinutes||45,enough=(n:number)=>n>=minimumSample;
    const slow=rows.filter(x=>x.deliveryMinutes!=null&&x.deliveryMinutes>cut),fast=rows.filter(x=>x.deliveryMinutes!=null&&x.deliveryMinutes<=cut);
    if(enough(slow.length)&&enough(fast.length)){
      const share=(list:any[])=>list.filter(x=>negativeOf(x,"temperature")).length/list.length,a=share(slow),b=share(fast);
      if(a>0&&a>=b*1.5)findings.push({type:"temperature_vs_delivery_time",statement:`Reclamações de temperatura concentradas em entregas acima de ${cut} minutos.`,volume:{slow:slow.length,fast:fast.length},rates:{slow:round(a*100),fast:round(b*100)},period});
    }
    const slowKitchen=rows.filter(x=>x.prepMinutes!=null&&x.prepMinutes>30),fastKitchen=rows.filter(x=>x.prepMinutes!=null&&x.prepMinutes<=30);
    if(enough(slowKitchen.length)&&enough(fastKitchen.length)){
      const rate=(list:any[])=>list.filter(x=>x.detractor).length/list.length,a=rate(slowKitchen),b=rate(fastKitchen);
      if(a>0&&a>=b*1.5)findings.push({type:"detractors_vs_prep_time",statement:"Avaliações baixas mais frequentes em pedidos com preparo acima de 30 minutos.",volume:{slow:slowKitchen.length,fast:fastKitchen.length},rates:{slow:round(a*100),fast:round(b*100)},period});
    }
    const overall=rows.filter(x=>x.normalized!=null),mean=overall.length?overall.reduce((s,x)=>s+x.normalized,0)/overall.length:null,items=new Map<string,{name:string;values:number[]}>();
    for(const row of overall)for(const item of row.items||[]){const entry=items.get(item.key)||{name:item.name,values:[] as number[]};entry.values.push(row.normalized);items.set(item.key,entry)}
    const itemStats=[...items.values()].map(x=>({name:x.name,responses:x.values.length,average:round(x.values.reduce((s,v)=>s+v,0)/x.values.length,2)})).sort((a,b)=>a.average-b.average);
    if(mean!=null)for(const item of itemStats)if(enough(item.responses)&&item.average<=mean-0.5)findings.push({type:"item_low_score",statement:`${item.name} com notas abaixo da média da loja.`,volume:{responses:item.responses},average:item.average,storeAverage:round(mean,2),period});
    const shifts=new Map<string,number[]>();
    for(const row of overall)if(row.hour!=null){const key=SHIFT(row.hour);shifts.set(key,[...(shifts.get(key)||[]),row.normalized])}
    const shiftStats=[...shifts].map(([shift,values])=>({shift,responses:values.length,average:enough(values.length)?round(values.reduce((s,v)=>s+v,0)/values.length,2):null}));
    if(mean!=null)for(const shift of shiftStats)if(shift.average!=null&&shift.average<=mean-0.5)findings.push({type:"shift_low_score",statement:`Notas abaixo da média no turno de ${shift.shift}. Olhe primeiro volume, cardápio e operação do turno.`,volume:{responses:shift.responses},average:shift.average,storeAverage:round(mean,2),period});
    const suppliers=new Map<string,{name:string;values:number[]}>();
    for(const row of overall)for(const supplier of row.suppliers||[]){const entry=suppliers.get(supplier.key)||{name:supplier.name,values:[] as number[]};entry.values.push(row.normalized);suppliers.set(supplier.key,entry)}
    if(mean!=null)for(const supplier of suppliers.values())if(enough(supplier.values.length)){const average=round(supplier.values.reduce((s,v)=>s+v,0)/supplier.values.length,2);if(average<=mean-0.5)findings.push({type:"supplier_low_score",statement:`Pedidos com lotes de ${supplier.name} têm notas abaixo da média.`,volume:{responses:supplier.values.length},average,storeAverage:round(mean,2),period})}
    const withIncident=rows.filter(x=>x.incidentNearby);
    if(enough(withIncident.length))findings.push({type:"incident_overlap",statement:"Parte das avaliações ocorreu perto de incidentes operacionais da loja.",volume:{responses:withIncident.length,detractors:withIncident.filter(x=>x.detractor).length},period});
    return{findings,items:itemStats,shifts:shiftStats,notice:CORRELATION_NOTICE,sample:{responses:rows.length,minimumSample},rankedPeople:false};
  }
  // Puts every scale on 0 to 1, so an NPS answer and a star rating can sit in the same average.
  normalize(score:number|null|undefined,scale:string){if(score==null)return null;const value=Number(score);return scale==="0-10"?value/10:scale==="1-7"?(value-1)/6:(value-1)/4}
}

export async function buildRootCause(ctx:{admin:any;organizationId:string;storeIds:string[]},input:{days:number;minimumSample:number;delayMinutes?:number}){
  const period=periodOf(input.days),since=`${period.from}T00:00:00Z`,{data:feedback}=await ctx.admin.from("crm_feedback").select("id,order_id,establishment_id,score,scale,feedback_type,answered_at,source").eq("organization_id",ctx.organizationId).in("establishment_id",ctx.storeIds).not("answered_at","is",null).gte("answered_at",since).limit(2000);
  const rows=(feedback||[]).filter((x:any)=>!(IMPORTED_SOURCES as readonly string[]).includes(x.source)),ids=rows.map((x:any)=>x.id),orderIds=rows.map((x:any)=>x.order_id).filter(Boolean);
  const empty={data:[] as any[]},[topics,items,deliveries,tickets,lots,incidents,stores]=await Promise.all([
    ids.length?ctx.admin.from("cx_feedback_topics").select("feedback_id,topic_key,polarity").in("feedback_id",ids).is("removed_at",null):empty,
    orderIds.length?ctx.admin.from("order_items").select("order_id,product_id,product_name").in("order_id",orderIds):empty,
    orderIds.length?ctx.admin.from("analytics_fact_delivery").select("order_id,delivery_minutes").in("order_id",orderIds):empty,
    orderIds.length?ctx.admin.from("kitchen_tickets").select("public_order_id,started_at,ready_at").in("public_order_id",orderIds):empty,
    orderIds.length?ctx.admin.from("order_item_lot_consumptions").select("order_id,inventory_lots(supplier_id,suppliers(name))").in("order_id",orderIds):empty,
    ctx.admin.from("operational_incidents").select("store_id,detected_at,resolved_at").eq("organization_id",ctx.organizationId).in("store_id",ctx.storeIds).gte("detected_at",since).limit(500),
    ctx.admin.from("establishments").select("id,timezone").in("id",ctx.storeIds),
  ]);
  const group=(list:any[],key:string)=>{const out=new Map<string,any[]>();for(const row of list||[])out.set(row[key],[...(out.get(row[key])||[]),row]);return out},topicBy=group(topics.data,"feedback_id"),itemBy=group(items.data,"order_id"),deliveryBy=group(deliveries.data,"order_id"),ticketBy=group(tickets.data,"public_order_id"),lotBy=group(lots.data,"order_id"),service=new RootCauseLinkService(),zones=new Map((stores.data||[]).map((x:any)=>[x.id,x.timezone||"America/Sao_Paulo"])),localHour=(at:number,storeId:string)=>Number(new Intl.DateTimeFormat("en-US",{hour:"numeric",hour12:false,timeZone:String(zones.get(storeId)||"America/Sao_Paulo")}).format(at))%24;
  const prepared=rows.map((row:any)=>{
    const ticket=(ticketBy.get(row.order_id)||[]).find((x:any)=>x.started_at&&x.ready_at),at=Date.parse(row.answered_at),suppliers=new Map<string,string>();
    for(const lot of lotBy.get(row.order_id)||[])if(lot.inventory_lots?.supplier_id)suppliers.set(lot.inventory_lots.supplier_id,lot.inventory_lots.suppliers?.name||"fornecedor");
    return{normalized:service.normalize(row.score==null?null:Number(row.score),row.scale),detractor:isDetractor({score:row.score==null?null:Number(row.score),scale:row.scale,feedback_type:row.feedback_type}),topics:topicBy.get(row.id)||[],items:(itemBy.get(row.order_id)||[]).map((x:any)=>({key:x.product_id||x.product_name,name:x.product_name})),deliveryMinutes:deliveryBy.get(row.order_id)?.[0]?.delivery_minutes??null,prepMinutes:ticket?(Date.parse(ticket.ready_at)-Date.parse(ticket.started_at))/6e4:null,hour:row.order_id?localHour(at,row.establishment_id):null,suppliers:[...suppliers].map(([key,name])=>({key,name})),incidentNearby:(incidents.data||[]).some((x:any)=>x.store_id===row.establishment_id&&Date.parse(x.detected_at)<=at&&at-Date.parse(x.detected_at)<=864e5)};
  });
  return service.analyze({rows:prepared,minimumSample:input.minimumSample,period,delayMinutes:input.delayMinutes});
}

export function responseMetrics(rows:any[]){
  const service=new ExperienceMetricsService(),publicRows=rows.filter(x=>x.is_public),answered=publicRows.filter(x=>x.first_responded_at),times=rows.filter(x=>x.first_responded_at&&x.answered_at).map(x=>(Date.parse(x.first_responded_at)-Date.parse(x.answered_at))/36e5);
  return{reviewResponseRate:service.rate({numerator:answered.length,denominator:publicRows.length,label:"avaliações públicas recebidas"}),medianResponseHours:times.length?round(service.median(times) as number,1):null,responseSample:times.length};
}
