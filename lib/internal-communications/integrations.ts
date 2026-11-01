/* eslint-disable @typescript-eslint/no-explicit-any */
/* Contracts with the rest of the product. Data only here, so Reporting, Workspace and Data Platform can import it without cycles. */
const COMMS_DIMENSIONS=["date","store"];
export const COMMS_REPORT_METRICS={
  comms_delivery_rate:{key:"comms_delivery_rate",label:"Taxa de entrega de comunicados",unit:"percent",aggregation:"ratio",additive:false,dimensions:COMMS_DIMENSIONS},
  comms_open_rate:{key:"comms_open_rate",label:"Taxa de abertura de comunicados",unit:"percent",aggregation:"ratio",additive:false,dimensions:COMMS_DIMENSIONS},
  comms_ack_rate:{key:"comms_ack_rate",label:"Taxa de confirmação de leitura",unit:"percent",aggregation:"ratio",additive:false,dimensions:COMMS_DIMENSIONS},
  comms_overdue_ack_count:{key:"comms_overdue_ack_count",label:"Confirmações em atraso",unit:"count",aggregation:"count",additive:true,dimensions:COMMS_DIMENSIONS},
  comms_time_to_ack:{key:"comms_time_to_ack",label:"Tempo até a confirmação",unit:"hours",aggregation:"semantic",additive:false,dimensions:COMMS_DIMENSIONS},
  comms_poll_responses:{key:"comms_poll_responses",label:"Respostas de enquetes",unit:"count",aggregation:"count",additive:true,dimensions:["date"]},
} as const;
export const COMMS_METRIC_DENOMINATORS={comms_delivery_rate:"destinatários",comms_open_rate:"entregues",comms_ack_rate:"destinatários de comunicados obrigatórios",comms_overdue_ack_count:"sem denominador; é uma contagem",comms_time_to_ack:"confirmados",comms_poll_responses:"sem denominador; é uma contagem"} as const;
const dataset=(id:string,name:string,description:string,metrics:string[],dimensions=COMMS_DIMENSIONS)=>({id,name,description,source:"warehouse",metrics,dimensions,filters:dimensions,timeGranularity:["day","week","month"],permissions:["reports:view"],sensitivity:"normal",realtime:false,maxDays:731});
export const COMMS_DATASET_DEFINITIONS={
  internal_announcements:dataset("internal_announcements","Comunicados internos","Comunicados publicados, por tipo e unidade.",["comms_delivery_rate","comms_open_rate","comms_ack_rate"]),
  announcement_deliveries:dataset("announcement_deliveries","Entrega de comunicados","Alcance agregado dos comunicados.",["comms_delivery_rate","comms_open_rate"]),
  announcement_acknowledgements:dataset("announcement_acknowledgements","Confirmações de leitura","Confirmações e atrasos de comunicados obrigatórios, sem nomes.",["comms_ack_rate","comms_overdue_ack_count","comms_time_to_ack"]),
  internal_polls:dataset("internal_polls","Enquetes internas","Respostas agregadas por enquete.",["comms_poll_responses"],["date"]),
} as const;
export const COMMS_REPORT_DATASETS=["internal_announcements","announcement_deliveries","announcement_acknowledgements","internal_polls"] as const;
export const COMMS_REPORT_TEMPLATES=["Alcance de comunicados","Pendências de leitura por unidade","Comunicados de crise"] as const;
export const COMMS_FACTS=["fact_comms_reach"] as const;
export const COMMS_WIDGETS=["comms_my_mandatory"] as const;
export const COMMS_AUTOMATION_TRIGGERS=["comms.published","comms.ack_overdue","comms.crisis_published","incident.declared","continuity.plan_activated"] as const;
// Automation can prepare and remind. Publishing, approving and sending outside the flow are not on this list.
export const COMMS_SAFE_AUTOMATION_ACTIONS=["comms_create_draft","comms_notify_pending","comms_escalate_manager"] as const;
export const COMMS_FORBIDDEN_ACTIONS=["publish_announcement","approve_announcement","send_outside_flow"] as const;
export const COMMS_PLAN_ENTITLEMENTS={basico:["internal_communications_enabled"],profissional:["internal_communications_enabled"],premium:["internal_communications_enabled","comms_board_enabled","comms_polls_enabled","comms_crisis_enabled"],enterprise:["internal_communications_enabled","comms_board_enabled","comms_polls_enabled","comms_crisis_enabled","comms_ai_drafts_enabled"]} as const;
export const COMMS_COPILOT_TOOLS=["getAnnouncements","getPendingAcknowledgements","draftAnnouncement","summarizeAnnouncement","simplifyLanguage","getCrisisCommunications"] as const;

const sentences=(text:string)=>String(text||"").replace(/\s+/g," ").trim().split(/(?<=[.!?:])\s+/).filter(Boolean);
export function summarizeText(text:string,max=2){const list=sentences(text);return list.slice(0,max).join(" ")+(list.length>max?" …":"")}
const word=(text:string)=>new RegExp(`(?<![\p{L}])${text}(?![\p{L}])`,"giu");
const PLAIN_WORDS:Array<[RegExp,string]>=[[word("deverá"),"precisa"],[word("deverão"),"precisam"],[word("utilizar"),"usar"],[word("utilize"),"use"],[word("solicitamos que"),"por favor,"],[word("comunicamos que"),""],[word("em virtude de"),"por causa de"],[word("com a finalidade de"),"para"],[word("procedimento operacional padrão"),"passo a passo"],[word("no que tange a"),"sobre"],[word("mediante"),"com"]];
export function simplifyText(text:string){let out=String(text||"");for(const[pattern,value]of PLAIN_WORDS)out=out.replace(pattern,value);return out.replace(/[ \t]{2,}/g," ").trim()}

// Read-only, built from what the module already returned for this person. It has no client to write with, which is the guarantee it cannot publish or approve.
export function commsCopilot(tool:string,data:any,input:any={}){
  if(!(COMMS_COPILOT_TOOLS as readonly string[]).includes(tool))throw new Error("TOOL_NOT_ALLOWED");
  const base={tool,canPublish:false,canApprove:false,canSend:false,notice:"O Copiloto só prepara texto. Publicar e aprovar continuam com pessoas."};
  const list:any[]=data?.announcements||[],line=(x:any)=>`${x.title} (${x.status})`;
  if(tool==="getAnnouncements")return{...base,answer:`${list.filter(x=>x.status==="published").length} comunicado(s) ativo(s), ${list.filter(x=>x.status==="scheduled").length} agendado(s) e ${list.filter(x=>x.status==="pending_approval").length} aguardando aprovação.`,items:list.slice(0,10).map(line)};
  if(tool==="getPendingAcknowledgements"){const pending=data?.pending||[];return{...base,answer:pending.length?`${pending.length} comunicado(s) obrigatório(s) com leitura pendente.`:"Nenhuma leitura obrigatória pendente.",items:pending.slice(0,10).map((x:any)=>`${x.title}: ${x.acknowledged} de ${x.recipients} confirmaram`)}}
  if(tool==="getCrisisCommunications"){const crisis=data?.crisis||[];return{...base,answer:crisis.length?`${crisis.length} comunicado(s) de crise ou recall.`:"Nenhum comunicado de crise.",items:crisis.slice(0,10).map(line)}}
  if(tool==="summarizeAnnouncement")return{...base,answer:summarizeText(String(input.body||""))};
  if(tool==="simplifyLanguage")return{...base,answer:simplifyText(String(input.body||""))};
  return{...base,answer:"Escolha um modelo na aba Novo Comunicado. O rascunho fica marcado como gerado por IA e só é publicado depois de aprovado por uma pessoa."};
}

// Report rows come from the aggregated view. It has no user column, so a report cannot be turned into a list of people.
export async function commsReportRows(c:any,definition:any,period:{from:string;to:string},limit:number){
  if(definition.datasetId==="internal_polls"){
    const{data:polls,error}=await c.a.from("comms_polls").select("id,question,created_at,status").eq("organization_id",c.organizationId).gte("created_at",`${period.from}T00:00:00Z`).lte("created_at",`${period.to}T23:59:59Z`).limit(limit);
    if(error)throw error;
    const rows=[];for(const poll of polls||[]){const{count}=await c.a.from("comms_poll_responses").select("id",{count:"exact",head:true}).eq("poll_id",poll.id);rows.push({date:String(poll.created_at).slice(0,10),poll:poll.question,status:poll.status,comms_poll_responses:count||0})}
    return{rows,freshness:{source:"comms_poll_responses",status:"current",metric_catalog:true}};
  }
  let query=c.a.from("fact_comms_reach").select("*").eq("organization_id",c.organizationId).gte("metric_date",period.from).lte("metric_date",period.to).in("store_id",c.storeIds);
  if(definition.datasetId==="announcement_acknowledgements")query=query.eq("acknowledgement_required",true);
  const{data,error}=await query.limit(limit);
  if(error)throw error;
  const ratio=(a:number,b:number)=>b?Math.round(a/b*1000)/10:null;
  return{rows:(data||[]).map((x:any)=>({date:x.metric_date,store:x.store_id,announcement_type:x.announcement_type,recipients:x.recipients,comms_delivery_rate:ratio(x.delivered,x.recipients),comms_open_rate:ratio(x.opened,x.delivered),comms_ack_rate:x.acknowledgement_required?ratio(x.acknowledged,x.recipients):null,comms_overdue_ack_count:x.acknowledgement_required?x.overdue:null,comms_time_to_ack:x.median_hours_to_ack==null?null:Math.round(Number(x.median_hours_to_ack)*10)/10})),freshness:{source:"fact_comms_reach",status:"current",metric_catalog:true}};
}
