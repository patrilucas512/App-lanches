/* eslint-disable @typescript-eslint/no-explicit-any */
/* Pure rules of the module. Nothing here touches the database, so publish, approval and privacy rules can be tested on their own. */
import {createHash} from "node:crypto";

export const COMMS_PERMISSIONS=["comms:view","comms:create","comms:publish_unit","comms:publish_network","comms:approve","comms:publish_crisis","comms:view_ack_status","comms:manage_templates","comms:moderate_board","comms:manage_governance"] as const;
export const COMMS_FLAGS=["internal_communications_enabled","comms_board_enabled","comms_polls_enabled","comms_crisis_enabled","comms_ai_drafts_enabled"] as const;
export const COMMS_STATUSES=["draft","pending_approval","approved","scheduled","published","expired","archived","retracted"] as const;
export const COMMS_PRIORITIES=["info","important","mandatory","urgent"] as const;
export const COMMS_TYPES=["general","procedure_change","menu_change","recall_food_safety","maintenance","store_opening","policy","training","crisis","celebration"] as const;
export const COMMS_REF_KEYS=["incident","continuity_plan","continuity_activation","sop","training","store_opening","audit","recall"] as const;
export const CRISIS_TYPES=["crisis","recall_food_safety"];
const NETWORK_SCOPES=["organization","brand","region","cluster","franchise"];

const ROLE_PERMISSIONS:Record<string,readonly string[]>={
  owner:COMMS_PERMISSIONS,admin:COMMS_PERMISSIONS,
  manager:["comms:view","comms:create","comms:publish_unit","comms:view_ack_status","comms:manage_templates","comms:moderate_board"],
  supervisor:["comms:view","comms:create","comms:view_ack_status"],
  analyst:["comms:view"],
};

export class CommsAccessService{
  // Anyone else in the store still reads what was sent to them. That path needs membership, not a permission.
  resolve(input:{orgRole?:string|null;storeRole?:string|null;explicit?:string[]}){
    const out=new Set<string>([...(ROLE_PERMISSIONS[String(input.orgRole)]||[]),...(ROLE_PERMISSIONS[String(input.storeRole)]||[])]);
    for(const key of input.explicit||[])if((COMMS_PERMISSIONS as readonly string[]).includes(key))out.add(key);
    return[...out];
  }
}

const TRANSITIONS:Record<string,string[]>={
  draft:["pending_approval","approved","scheduled","published","archived"],
  pending_approval:["approved","draft"],
  approved:["scheduled","published","draft","archived"],
  scheduled:["published","draft","archived"],
  published:["expired","archived","retracted"],
  expired:["archived","retracted"],
  archived:[],retracted:[],
};
export const canTransition=(from:string,to:string)=>(TRANSITIONS[from]||[]).includes(to);

export const contentHash=(title:string,body:string)=>createHash("sha256").update(`${normalize(title)}\n${normalize(body)}`).digest("hex");
const normalize=(text:unknown)=>String(text||"").toLowerCase().replace(/\s+/g," ").trim();

// A changed date, quantity or dose is always relevant, however small the edit looks.
export function isMaterialChange(before:{title:string;body:string},after:{title:string;body:string},explicit?:boolean){
  if(explicit===true)return true;
  const a=normalize(`${before.title} ${before.body}`),b=normalize(`${after.title} ${after.body}`);
  if(a===b)return false;
  const digits=(x:string)=>(x.match(/\d+/g)||[]).join(",");
  if(digits(a)!==digits(b))return true;
  const left=new Set(a.split(" ")),right=new Set(b.split(" ")),changed=[...left].filter(x=>!right.has(x)).length+[...right].filter(x=>!left.has(x)).length;
  return changed/Math.max(1,left.size+right.size)>=0.15;
}

const validCpf=(raw:string)=>{const d=raw.replace(/\D/g,"");if(d.length!==11||/^(\d)\1+$/.test(d))return false;const check=(n:number)=>{let sum=0;for(let i=0;i<n;i++)sum+=Number(d[i])*(n+1-i);const r=(sum*10)%11;return(r===10?0:r)===Number(d[n])};return check(9)&&check(10)};
const validCard=(raw:string)=>{const d=raw.replace(/\D/g,"");if(d.length<13||d.length>19)return false;let sum=0,alt=false;for(let i=d.length-1;i>=0;i--){let n=Number(d[i]);if(alt){n*=2;if(n>9)n-=9}sum+=n;alt=!alt}return sum%10===0};

// A document number never leaves in an announcement. A sensitive word can be legitimate ("como entregar o atestado"), so it asks a person to confirm.
export function checkContent(text:string){
  const value=String(text||""),blocked:string[]=[],warnings:string[]=[];
  if((value.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g)||[]).some(validCpf))blocked.push("CPF");
  if((value.match(/\b(?:\d[ -]?){13,19}\b/g)||[]).some(validCard))blocked.push("CARD");
  if(/[\w.+-]+@[\w-]+\.[\w.-]+/.test(value))blocked.push("EMAIL");
  if(/(?:\+?55[\s-]?)?\(?\b[1-9]\d\)?[\s-]?9\d{4}[\s-]?\d{4}\b/.test(value))blocked.push("PHONE");
  if(/sal[aá]rio|holerite|remunera[cç][aã]o/i.test(value))warnings.push("SALARY");
  if(/atestado|diagn[oó]stico|doen[cç]a|gravidez|\bcid\b/i.test(value))warnings.push("HEALTH");
  if(/dados? d[eo]s? clientes?|nome do cliente/i.test(value))warnings.push("CUSTOMER_DATA");
  return{blocked,warnings,ok:!blocked.length};
}

export function isNetworkAudience(scopeType:string,targetStores:number){return NETWORK_SCOPES.includes(scopeType)&&targetStores>1}

// The floor is here on purpose. A policy can ask for more; it cannot take any of these away.
export function approvalRequirement(input:{type:string;scopeType:string;targetStores:number;aiGenerated?:boolean;policyRequires?:boolean}){
  const reasons:string[]=[];
  if(isNetworkAudience(input.scopeType,input.targetStores))reasons.push("network_wide");
  if(input.type==="crisis")reasons.push("crisis");
  if(input.type==="recall_food_safety")reasons.push("recall");
  if(input.type==="policy")reasons.push("policy_change");
  if(input.aiGenerated)reasons.push("ai_generated");
  if(input.policyRequires)reasons.push("policy_engine");
  return{required:reasons.length>0,reasons};
}

export function publishPermissions(input:{type:string;scopeType:string}){
  const out=[NETWORK_SCOPES.includes(input.scopeType)?"comms:publish_network":"comms:publish_unit"];
  if(CRISIS_TYPES.includes(input.type))out.push("comms:publish_crisis");
  return out;
}

export function emergencyGate(input:{allowedByPolicy:boolean;permissions:string[];type:string;priority:string;reason?:string;aiGenerated?:boolean}){
  const issues:string[]=[];
  if(!input.allowedByPolicy)issues.push("EMERGENCY_NOT_ALLOWED");
  if(!input.permissions.includes("comms:publish_crisis"))issues.push("FORBIDDEN");
  if(!CRISIS_TYPES.includes(input.type)&&input.priority!=="urgent")issues.push("EMERGENCY_NOT_URGENT");
  if(String(input.reason||"").trim().length<10)issues.push("REASON_REQUIRED");
  // AI never publishes without a person's approval, including through the emergency door.
  if(input.aiGenerated)issues.push("AI_REQUIRES_APPROVAL");
  return{allowed:!issues.length,issues};
}

export function canDecideApproval(input:{approverId:string;authorId?:string|null;requesterId?:string|null;alreadyDecided:string[];selfApprovalAllowed?:boolean}){
  if(input.alreadyDecided.includes(input.approverId))return{allowed:false,reason:"ALREADY_DECIDED"};
  if(!input.selfApprovalAllowed&&(input.approverId===input.authorId||input.approverId===input.requesterId))return{allowed:false,reason:"SELF_APPROVAL_BLOCKED"};
  return{allowed:true,reason:null};
}

export function sanitizeRefs(value:unknown){
  const out:Record<string,string[]>={};
  if(!value||typeof value!=="object")return out;
  for(const key of COMMS_REF_KEYS){const ids=(value as any)[key];if(Array.isArray(ids)&&ids.length)out[key]=[...new Set(ids.map(String))].slice(0,20)}
  return out;
}

export function reminderDue(input:{state:string;ackDueAt?:string|null;reminderCount:number;lastReminderAt?:string|null;hoursBefore:number;intervalHours:number;maxReminders:number;now:Date}){
  if(input.state==="acknowledged"||!input.ackDueAt||input.reminderCount>=input.maxReminders)return false;
  const now=input.now.getTime();
  if(input.lastReminderAt&&now-Date.parse(input.lastReminderAt)<input.intervalHours*36e5)return false;
  return Date.parse(input.ackDueAt)-now<=input.hoursBefore*36e5;
}

// Rates always carry their denominator. There is deliberately no per-person variant of this function.
export function reachMetrics(rows:Array<{recipients:number;delivered:number;opened:number;acknowledged:number;overdue:number;median_hours_to_ack?:number|null;acknowledgement_required?:boolean}>){
  const sum=(key:string,list=rows)=>list.reduce((n,x:any)=>n+Number(x[key]||0),0),required=rows.filter(x=>x.acknowledgement_required),rate=(a:number,b:number)=>b?Math.round(a/b*1000)/10:null;
  const medians=rows.map(x=>x.median_hours_to_ack).filter(x=>x!=null).map(Number).sort((a,b)=>a-b),mid=medians.length>>1;
  return{
    deliveryRate:{value:rate(sum("delivered"),sum("recipients")),numerator:sum("delivered"),denominator:sum("recipients"),denominatorLabel:"destinatários"},
    openRate:{value:rate(sum("opened"),sum("delivered")),numerator:sum("opened"),denominator:sum("delivered"),denominatorLabel:"entregues"},
    acknowledgementRate:{value:rate(sum("acknowledged",required),sum("recipients",required)),numerator:sum("acknowledged",required),denominator:sum("recipients",required),denominatorLabel:"destinatários de comunicados obrigatórios"},
    overdueAcknowledgements:sum("overdue",required),
    medianHoursToAcknowledge:medians.length?(medians.length%2?medians[mid]:(medians[mid-1]+medians[mid])/2):null,
  };
}

export const mustData=(result:{data:any;error:any},step:string):any=>{if(result.error)throw new Error(`${step}: ${result.error.message}`);return result.data};
