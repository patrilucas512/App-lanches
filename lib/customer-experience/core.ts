/* eslint-disable @typescript-eslint/no-explicit-any */
/* Customer Experience: pure, explainable rules. crm_feedback stays the only feedback table; nothing here moves money or publishes. */
export const CX_PERMISSIONS=["cx:view","cx:view_sensitive","cx:manage_surveys","cx:respond","cx:approve_response","cx:manage_recovery","cx:approve_compensation","cx:manage_sources","cx:manage_governance"] as const;
export const CX_FLAGS=["customer_experience_enabled","cx_surveys_enabled","cx_external_reviews_enabled","cx_ai_sentiment_enabled","cx_ai_response_drafts_enabled","cx_service_recovery_enabled"] as const;
export const FEEDBACK_SOURCES=["whatsapp","qr_table","customer_portal","receipt_link","kiosk","email","marketplace_import","google_import","staff_logged","other"] as const;
export const IMPORTED_SOURCES=["marketplace_import","google_import"] as const;
export const FEEDBACK_TYPES=["nps","csat","ces","star_rating","item_rating","open_comment","complaint","compliment"] as const;
export const DIMENSIONS=["food_quality","temperature","portion","packaging","delivery_time","delivery_courier","service","cleanliness","ambiance","price_value","order_accuracy","app_experience","payment"] as const;
export const INBOX_STATUS=["new","triaged","awaiting_response","responded","recovery_in_progress","resolved","escalated","closed"] as const;
export const SCALES={"1-5":{min:1,max:5},"0-10":{min:0,max:10},"1-7":{min:1,max:7}} as const;
export const CORRELATION_NOTICE="Correlação não é causa: estes números mostram o que aconteceu junto, não o motivo.";

export type Scale=keyof typeof SCALES;
export type Permission=typeof CX_PERMISSIONS[number];

const MANAGER_PERMISSIONS:Permission[]=["cx:view","cx:view_sensitive","cx:respond","cx:manage_recovery"];

export class CustomerExperienceAccessService{
  resolve(input:{orgRole?:string|null;storeRole?:string|null;explicit?:string[]}){
    const permissions=new Set<string>(input.explicit||[]);
    if(input.orgRole==="owner"||input.orgRole==="admin"||input.storeRole==="owner")CX_PERMISSIONS.forEach(x=>permissions.add(x));
    else if(input.storeRole==="manager"||input.orgRole==="supervisor")MANAGER_PERMISSIONS.forEach(x=>permissions.add(x));
    return[...permissions];
  }
  check(input:{organizationId?:string|null;resourceOrganizationId?:string|null;permissions:string[];required:string}){const tenant=Boolean(input.organizationId&&input.organizationId===input.resourceOrganizationId);return{allowed:tenant&&input.permissions.includes(input.required),tenantIsolated:tenant}}
}

const PII:Array<[RegExp,string]>=[[/[\w.+-]+@[\w-]+\.[\w.-]+/g,"[e-mail]"],[/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g,"[documento]"],[/(?:\+?55\s?)?\(?\b\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}\b/g,"[telefone]"]];
export const maskPii=(text:string|null|undefined)=>PII.reduce((value,[pattern,mask])=>value.replace(pattern,mask),String(text||""));
export const hasPii=(text:string)=>PII.some(([pattern])=>{pattern.lastIndex=0;const found=pattern.test(text);pattern.lastIndex=0;return found});

export function validScore(score:unknown,scale:Scale){const value=Number(score),range=SCALES[scale];return score!==null&&score!==""&&Number.isFinite(value)&&value>=range.min&&value<=range.max}
export function npsClass(score:number){return score>=9?"promoter":score>=7?"passive":"detractor"}

// One rule for the whole module, so a detractor in the inbox is the same as a detractor in a report.
export function isDetractor(input:{score?:number|null;scale?:string|null;feedback_type?:string|null}){
  if(input.score==null)return input.feedback_type==="complaint";
  if(input.scale==="0-10")return input.score<=6;
  if(input.scale==="1-7")return input.score<=3;
  return input.score<=2;
}

export type MetricResult={status:"ok"|"insufficient_sample"|"no_data";value:number|null;responses:number;minimumSample:number;denominator:string;[key:string]:unknown};
const sampled=(responses:number,minimumSample:number,denominator:string):MetricResult|null=>responses===0?{status:"no_data",value:null,responses,minimumSample,denominator}:responses<minimumSample?{status:"insufficient_sample",value:null,responses,minimumSample,denominator}:null;

export class ExperienceMetricsService{
  nps(input:{promoters:number;passives:number;detractors:number;minimumSample:number}):MetricResult{
    const responses=input.promoters+input.passives+input.detractors,denominator="respostas NPS no período",blocked=sampled(responses,input.minimumSample,denominator),counts={promoters:input.promoters,passives:input.passives,detractors:input.detractors};
    if(blocked)return{...blocked,...counts};
    return{status:"ok",value:Math.round((input.promoters-input.detractors)/responses*100),responses,minimumSample:input.minimumSample,denominator,...counts};
  }
  csat(input:{scoreSum:number;responses:number;satisfied:number;minimumSample:number}):MetricResult{
    const denominator="respostas CSAT e notas de 1 a 5 no período",blocked=sampled(input.responses,input.minimumSample,denominator);
    if(blocked)return blocked;
    return{status:"ok",value:Math.round(input.scoreSum/input.responses*100)/100,satisfiedRate:Math.round(input.satisfied/input.responses*1000)/10,responses:input.responses,minimumSample:input.minimumSample,denominator};
  }
  rate(input:{numerator:number;denominator:number;label:string;minimumSample?:number}):MetricResult{
    const blocked=sampled(input.denominator,input.minimumSample||1,input.label);
    if(blocked)return blocked;
    return{status:"ok",value:Math.round(input.numerator/input.denominator*1000)/10,numerator:input.numerator,responses:input.denominator,minimumSample:input.minimumSample||1,denominator:input.label};
  }
  median(values:number[]){if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2}
}

// Aggregates fact_cx_feedback rows: imported reviews never enter NPS or CSAT, which only count the store's own surveys.
export function summarizeFacts(rows:any[],minimumSample:number){
  const service=new ExperienceMetricsService(),own=rows.filter(x=>!(IMPORTED_SOURCES as readonly string[]).includes(x.source)),sum=(list:any[],key:string)=>list.reduce((total,x)=>total+Number(x[key]||0),0),nps=own.filter(x=>x.scale==="0-10"),csat=own.filter(x=>x.scale==="1-5"&&["csat","star_rating"].includes(x.feedback_type)),external=rows.filter(x=>(IMPORTED_SOURCES as readonly string[]).includes(x.source));
  const externalScored=sum(external,"scored_count");
  return{
    nps:service.nps({promoters:sum(nps,"promoters"),passives:sum(nps,"passives"),detractors:sum(nps,"detractors"),minimumSample}),
    csat:service.csat({scoreSum:sum(csat,"score_sum"),responses:sum(csat,"scored_count"),satisfied:sum(csat,"satisfied"),minimumSample}),
    externalAverage:externalScored>=minimumSample?{status:"ok",value:Math.round(sum(external,"score_sum")/externalScored*100)/100,responses:externalScored}:{status:externalScored?"insufficient_sample":"no_data",value:null,responses:externalScored},
    volume:sum(rows,"response_count"),
  };
}

export const INBOX_TRANSITIONS:Record<string,string[]>={new:["triaged","awaiting_response","recovery_in_progress","escalated","closed"],triaged:["awaiting_response","recovery_in_progress","escalated","responded","closed"],awaiting_response:["responded","recovery_in_progress","escalated","closed"],responded:["recovery_in_progress","resolved","closed"],recovery_in_progress:["responded","resolved","escalated","closed"],resolved:["closed","recovery_in_progress"],escalated:["recovery_in_progress","resolved","closed"],closed:["triaged"]};
export class ReviewInboxService{
  canTransition(from:string,to:string){return(INBOX_TRANSITIONS[from]||[]).includes(to)}
  sla(row:{response_due_at?:string|null;first_responded_at?:string|null;inbox_status?:string},now=Date.now()){
    if(row.first_responded_at||["responded","resolved","closed"].includes(String(row.inbox_status)))return"met";
    if(!row.response_due_at)return"none";
    return Date.parse(row.response_due_at)<now?"overdue":"on_time";
  }
}
