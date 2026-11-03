/* eslint-disable @typescript-eslint/no-explicit-any */
/* Pure rules of the privacy module. Nothing here touches the database, so the decisions that matter (who sees what, what may be
   deleted, when a message may go out) can be tested on their own. Legal texts, deadlines and legal bases are data the tenant's
   DPO configures; the defaults below are starting points marked for legal review, never an interpretation of the law. */
import {createHmac} from "node:crypto";

export const PRIVACY_PERMISSIONS=["privacy:view","privacy:view_subject_data","privacy:manage_inventory","privacy:manage_ropa","privacy:manage_consents","privacy:handle_dsr","privacy:approve_dsr","privacy:execute_deletion","privacy:manage_retention","privacy:approve_retention_run","privacy:manage_legal_holds","privacy:manage_incidents","privacy:manage_dpia","privacy:dpo","privacy:manage_governance"] as const;
export const PRIVACY_FLAGS=["privacy_operations_enabled","privacy_dsr_portal_enabled","privacy_retention_execution_enabled","privacy_auto_anonymization_enabled","privacy_ai_assistance_enabled"] as const;
export const CONTEXT_KINDS=["tenant_controller","platform_controller"] as const;
export const DATA_CATEGORIES=["identification","contact","address","location","payment_reference","order_history","preferences","communication","voice","image","employee","driver","health_allergy","device_technical"] as const;
export const SENSITIVE_CATEGORIES=["health_allergy"];
export const SUBJECT_CATEGORIES=["end_customer","lead","employee","driver","supplier_contact","saas_customer","saas_user"] as const;
export const LEGAL_BASIS_KEYS=["consent","contract","legal_obligation","legitimate_interest","exercise_of_rights","credit_protection","health_protection","other"] as const;
export const DSR_TYPES=["confirmation","access","correction","anonymization","blocking","deletion","portability","sharing_info","consent_revocation","automated_decision_review","opposition"] as const;
export const DSR_STATUSES=["received","verifying","in_progress","awaiting_approval","fulfilled","partially_fulfilled","rejected_with_reason","closed"] as const;
export const DSR_CHANNELS=["customer_portal","whatsapp","email","manual"] as const;
export const RETENTION_ACTIONS=["anonymize","delete","archive","review"] as const;
export const RETENTION_TRIGGERS=["after_created","after_last_order","after_last_activity","after_closed"] as const;
export const HOLD_REASONS=["fiscal","financial","contract","litigation","incident_investigation","other"] as const;
export const CONSENT_STATUSES=["granted","revoked","expired"] as const;
export const ANONYMIZATION_TECHNIQUES=["suppress","generalize","hash","mask","truncate_date","tokenize"] as const;
// Domains whose records the law may require us to keep. Deletion never removes them; at most the personal link is anonymized.
export const LEGAL_RETENTION_DOMAINS=["fiscal","financial","contracts","audit"] as const;

const ALL=PRIVACY_PERMISSIONS;
// The tenant owner is the controller of its customers' data, so it holds the whole module. Executing deletion and acting as
// DPO stay out of every other role: they come only from an explicit grant governed by Identity Governance (Phase 93).
const ROLE_PERMISSIONS:Record<string,readonly string[]>={
  owner:ALL,admin:ALL.filter(x=>x!=="privacy:dpo"),
  manager:["privacy:view","privacy:handle_dsr","privacy:manage_consents"],
  supervisor:["privacy:view"],analyst:["privacy:view"],
};
export class PrivacyAccessService{
  resolve(input:{orgRole?:string|null;storeRole?:string|null;explicit?:string[]}){
    const out=new Set<string>([...(ROLE_PERMISSIONS[String(input.orgRole)]||[]),...(ROLE_PERMISSIONS[String(input.storeRole)]||[])]);
    for(const key of input.explicit||[])if((PRIVACY_PERMISSIONS as readonly string[]).includes(key))out.add(key);
    return[...out];
  }
}

// A DPO of one tenant reads only its own context. The platform context belongs to MasterApp as controller of its SaaS customers.
export function canSeeContext(context:{kind:string;organization_id?:string|null},viewer:{organizationId?:string|null;superadmin?:boolean}){
  if(context.kind==="platform_controller")return viewer.superadmin===true;
  return Boolean(context.organization_id)&&context.organization_id===viewer.organizationId;
}

const DSR_TRANSITIONS:Record<string,string[]>={
  received:["verifying","in_progress","rejected_with_reason"],
  verifying:["in_progress","rejected_with_reason"],
  in_progress:["awaiting_approval","fulfilled","partially_fulfilled","rejected_with_reason"],
  awaiting_approval:["in_progress","fulfilled","partially_fulfilled","rejected_with_reason"],
  fulfilled:["closed"],partially_fulfilled:["in_progress","closed"],rejected_with_reason:["closed"],closed:[],
};
export const canTransitionDsr=(from:string,to:string)=>(DSR_TRANSITIONS[from]||[]).includes(to);

// Deadlines come from settings, per type and context. A type without a configured deadline has no due date, and the screen says so.
export function dsrDueAt(input:{type:string;receivedAt:string|Date;deadlineDays:Record<string,number|null|undefined>}){
  const days=input.deadlineDays?.[input.type]??input.deadlineDays?.default;
  if(days==null||!(Number(days)>0))return null;
  return new Date(new Date(input.receivedAt).getTime()+Number(days)*864e5).toISOString();
}
export function dsrAlert(input:{dueAt?:string|null;status:string;now:Date;alertDaysBefore:number}){
  if(!input.dueAt||["fulfilled","partially_fulfilled","rejected_with_reason","closed"].includes(input.status))return"none";
  const left=Date.parse(input.dueAt)-input.now.getTime();
  if(left<0)return"overdue";
  return left<=input.alertDaysBefore*864e5?"due_soon":"ok";
}

// Identity proof is proportional: a code to a contact already on file, never a document unless a person decides it is needed.
const HIGH_RISK=["access","portability","deletion","anonymization","correction","blocking"];
export function verificationRequirement(input:{type:string;channel:string;portalSessionVerified?:boolean}){
  if(input.channel==="customer_portal"&&input.portalSessionVerified)return{method:"portal_session",required:false,collectDocument:false};
  if(HIGH_RISK.includes(input.type))return{method:"otp_registered_contact",required:true,collectDocument:false};
  return{method:"otp_registered_contact",required:input.type!=="sharing_info",collectDocument:false};
}
export function canDeliverSubjectData(request:{verification_status?:string|null}){return request.verification_status==="verified"}

/* Consent. Transactional messages about an order never depend on marketing consent. Marketing needs a live grant for that exact
   purpose and channel; when the registry cannot be read, marketing does not go out (fail-safe). */
export function consentDecision(input:{kind:"transactional"|"marketing";purpose:string;channel:string;records:any[]|null;registryAvailable:boolean;now:Date;currentTextVersion?:Record<string,number>;requireCurrentVersion?:boolean}){
  if(input.kind==="transactional")return{allowed:true,reason:"TRANSACTIONAL"};
  if(!input.registryAvailable||input.records==null)return{allowed:false,reason:"REGISTRY_UNAVAILABLE"};
  const relevant=input.records.filter(x=>x.purpose===input.purpose&&(x.channel===input.channel||x.channel==="any")).sort((a,b)=>String(b.recorded_at||b.created_at).localeCompare(String(a.recorded_at||a.created_at)));
  const latest=relevant[0];
  if(!latest)return{allowed:false,reason:"NO_CONSENT"};
  if(latest.status!=="granted")return{allowed:false,reason:latest.status==="revoked"?"REVOKED":"EXPIRED"};
  if(latest.expires_at&&Date.parse(latest.expires_at)<=input.now.getTime())return{allowed:false,reason:"EXPIRED"};
  const current=input.currentTextVersion?.[input.purpose];
  if(input.requireCurrentVersion&&current!=null&&Number(latest.text_version)<current)return{allowed:false,reason:"NEW_VERSION_REQUIRES_ACCEPTANCE"};
  return{allowed:true,reason:"GRANTED"};
}

/* Anonymization. Salted hashes use a salt per tenant, so the same phone never maps to the same token in two tenants. */
export function pseudonym(value:unknown,salt:string){
  if(!salt||salt.length<16)throw new Error("SALT_REQUIRED");
  return value==null||value===""?null:`psd_${createHmac("sha256",salt).update(String(value).trim().toLowerCase()).digest("hex").slice(0,24)}`;
}
export function anonymizeValue(technique:string,value:any,options:{salt?:string;keep?:string[]}={}){
  if(value==null)return null;
  switch(technique){
    case"suppress":return null;
    case"hash":return pseudonym(value,String(options.salt||""));
    case"mask":{const text=String(value),digits=text.replace(/\D/g,"");return digits.length>=4?`••••${digits.slice(-2)}`:"••••"}
    case"truncate_date":return String(value).slice(0,4);
    // Address keeps only the coarse parts (neighbourhood, city, state), which is what delivery statistics use.
    case"generalize":{if(typeof value!=="object")return null;const keep=options.keep||["neighborhood","city","state"];return Object.fromEntries(keep.filter(k=>value[k]!=null).map(k=>[k,value[k]]))}
    case"tokenize":throw new Error("TOKENIZATION_REQUIRES_GOVERNED_VAULT");
    default:throw new Error("TECHNIQUE_INVALID");
  }
}
const DIRECT_IDENTIFIER=/^(name|full_name|customer_name|first_name|last_name|phone|customer_phone|whatsapp|email|customer_email|cpf|document|tax_id|birth_date|street|address_line|number|complement|postal_code|reference|latitude|longitude|lat|lng|ip|ip_address|device_id)$/i;
// After anonymization nothing in the row may still point at the person by itself, inside the scope the policy names.
export function reidentificationRisks(row:Record<string,any>,allowed:string[]=[]){
  const risks:string[]=[];
  for(const[key,value]of Object.entries(row||{})){
    if(allowed.includes(key)||value==null||value==="")continue;
    if(DIRECT_IDENTIFIER.test(key)&&!String(value).startsWith("psd_")&&!String(value).startsWith("••••"))risks.push(key);
    if(typeof value==="string"&&(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/.test(value)||/[\w.+-]+@[\w-]+\.[\w.-]+/.test(value)||/\(?\b[1-9]\d\)?\s?9\d{4}-?\d{4}\b/.test(value)))risks.push(`${key}:content`);
  }
  return[...new Set(risks)];
}

/* Deletion plan. What may go, what is anonymized and what the law keeps, with the reason for each, before anyone approves. */
export type SubjectRecord={domain:string;table:string;recordId:string;categories:string[];legalRetention?:string|null;personalLinkFields?:string[];adapterStatus?:"implemented"|"pending";anonymizeOnly?:boolean};
export function planDeletion(input:{records:SubjectRecord[];holds:Array<{scope_type:string;scope_ref?:string|null;domain?:string|null;status:string;valid_until?:string|null;reason:string}>;subjectRef:string;mode:"deletion"|"anonymization"|"blocking";now:Date}){
  const activeHolds=input.holds.filter(h=>h.status==="active"&&(!h.valid_until||Date.parse(h.valid_until)>input.now.getTime()));
  const heldBy=(r:SubjectRecord)=>activeHolds.find(h=>(h.scope_type==="subject"&&h.scope_ref===input.subjectRef)||(h.scope_type==="dataset"&&(h.domain===r.domain||h.scope_ref===r.table)));
  return input.records.map(r=>{
    const hold=heldBy(r);
    if(hold)return{...r,decision:"retain",reason:`legal_hold:${hold.reason}`};
    if(r.adapterStatus==="pending")return{...r,decision:"manual",reason:"adapter_pending"};
    if(r.legalRetention||(LEGAL_RETENTION_DOMAINS as readonly string[]).includes(r.domain))return{...r,decision:r.personalLinkFields?.length?"anonymize_link":"retain",reason:`legal_retention:${r.legalRetention||r.domain}`};
    if(input.mode==="blocking")return{...r,decision:"block",reason:"subject_request"};
    // Rows other records depend on (a customer behind its orders) are anonymized instead of deleted, keeping totals intact.
    if(r.anonymizeOnly)return{...r,decision:"anonymize",reason:input.mode==="deletion"?"referential_integrity":"subject_request"};
    return{...r,decision:input.mode==="anonymization"?"anonymize":"delete",reason:"subject_request"};
  });
}
export function planSummary(items:Array<{decision:string}>){
  const count=(d:string)=>items.filter(x=>x.decision===d).length;
  return{delete:count("delete"),anonymize:count("anonymize")+count("anonymize_link"),retain:count("retain"),block:count("block"),manual:count("manual"),total:items.length};
}
// A request is fulfilled only when every domain finished. One failure or one manual step leaves it partial, never complete.
export function aggregateExecution(steps:Array<{status:string}>){
  if(!steps.length)return"in_progress";
  if(steps.some(s=>["queued","running"].includes(s.status)))return"in_progress";
  if(steps.every(s=>["completed","skipped_retained","verified"].includes(s.status)))return"fulfilled";
  return"partially_fulfilled";
}

/* Retention. Only records past the configured period come out, and anything under a legal hold is skipped and reported. */
export function retentionDue(policy:{trigger:string;period_days:number},record:{created_at?:string|null;last_order_at?:string|null;last_activity_at?:string|null;closed_at?:string|null},now:Date){
  const from=policy.trigger==="after_last_order"?record.last_order_at:policy.trigger==="after_last_activity"?record.last_activity_at:policy.trigger==="after_closed"?record.closed_at:record.created_at;
  if(!from||!(policy.period_days>0))return false;
  return Date.parse(from)+policy.period_days*864e5<=now.getTime();
}
export function retentionRunGate(input:{mode:"dry_run"|"execute";executionFlag:boolean;approvalStatus?:string|null;requiresApproval:boolean}){
  if(input.mode==="dry_run")return{allowed:true,writes:false};
  const issues:string[]=[];
  if(!input.executionFlag)issues.push("RETENTION_EXECUTION_DISABLED");
  if(input.requiresApproval&&input.approvalStatus!=="approved")issues.push("APPROVAL_REQUIRED");
  return{allowed:!issues.length,writes:!issues.length,issues};
}
export function holdNeedsReview(hold:{valid_until?:string|null;last_reviewed_at?:string|null;created_at:string;status:string},now:Date,reviewDays:number){
  if(hold.status!=="active"||hold.valid_until)return false;
  return Date.parse(hold.last_reviewed_at||hold.created_at)+reviewDays*864e5<=now.getTime();
}

// RIPD/DPIA triggers are settings. These are the defaults the brief lists; the DPO may add or remove any of them.
export const DEFAULT_DPIA_TRIGGERS=["sensitive_data","driver_location_monitoring","ai_with_personal_data","marketing_profiling","new_sharing_integration"] as const;
export function dpiaRequired(activity:{data_categories?:string[];systems?:string[];purposes_tags?:string[];shares_with_third_parties?:boolean;uses_ai?:boolean;profiling?:boolean;location_monitoring?:boolean},triggers:readonly string[]){
  const reasons:string[]=[];
  if(triggers.includes("sensitive_data")&&(activity.data_categories||[]).some(c=>SENSITIVE_CATEGORIES.includes(c)))reasons.push("sensitive_data");
  if(triggers.includes("driver_location_monitoring")&&activity.location_monitoring)reasons.push("driver_location_monitoring");
  if(triggers.includes("ai_with_personal_data")&&activity.uses_ai)reasons.push("ai_with_personal_data");
  if(triggers.includes("marketing_profiling")&&activity.profiling)reasons.push("marketing_profiling");
  if(triggers.includes("new_sharing_integration")&&activity.shares_with_third_parties)reasons.push("new_sharing_integration");
  return{required:reasons.length>0,reasons};
}
// Legitimate interest asks for a recorded balancing test (LIA) when the tenant's settings say so.
export function ropaIssues(activity:{legal_basis_key?:string|null;lia_reference?:string|null;purpose?:string|null;retention_summary?:string|null;owner_user_id?:string|null},settings:{require_lia_for_legitimate_interest:boolean}){
  const issues:string[]=[];
  if(!activity.purpose||String(activity.purpose).trim().length<5)issues.push("PURPOSE_REQUIRED");
  if(!activity.legal_basis_key)issues.push("LEGAL_BASIS_REQUIRED");
  if(activity.legal_basis_key==="legitimate_interest"&&settings.require_lia_for_legitimate_interest&&!activity.lia_reference)issues.push("LIA_REQUIRED");
  if(!activity.retention_summary)issues.push("RETENTION_REQUIRED");
  if(!activity.owner_user_id)issues.push("OWNER_REQUIRED");
  return issues;
}

/* Privacy by design. A change that creates personal fields, a new purpose, a new sharing or AI over personal data gets a checklist. */
export function privacyChecklistFor(change:{creates_personal_fields?:boolean;new_purpose?:boolean;new_sharing?:boolean;ai_with_personal_data?:boolean;sensitive_data?:boolean}){
  const items:string[]=[];
  if(change.creates_personal_fields)items.push("map_new_fields","define_retention","minimize_fields");
  if(change.new_purpose)items.push("register_processing_activity","confirm_legal_basis");
  if(change.new_sharing)items.push("register_subprocessor","check_dpa","check_international_transfer");
  if(change.ai_with_personal_data)items.push("register_ai_use","check_purpose_and_consent");
  if(change.sensitive_data)items.push("dpia");
  const dpia=Boolean(change.sensitive_data||change.ai_with_personal_data||change.new_sharing);
  return{required:items.length>0,items:[...new Set(items)],dpiaSuggested:dpia};
}
const PERSONAL_COLUMN=/^(?:.*_)?(name|full_name|phone|whatsapp|email|cpf|cnpj_cpf|document|tax_id|birth_date|birthday|address|street|postal_code|cep|latitude|longitude|lat|lng|location|ip|ip_address|device_id|allerg[a-z]*|health[a-z_]*|voice_url|recording_url|transcript|photo_url|selfie[a-z_]*)$/i;
const NOT_PERSONAL=/^(?:.*_)?(product|store|establishment|organization|brand|region|cluster|category|plan|template|file|table|column|domain|policy|role|permission|metric|dataset|feature|event|job|queue|vendor|supplier|channel|purpose|source|display)_name$|^(display_name|name_key|table_name|column_name)$/i;
// CI aid: personal-looking columns a migration adds without an entry in the data map become a warning, never a failure.
export function detectPersonalColumns(sql:string){
  const out:Array<{table:string;column:string}>=[];
  const clean=String(sql||"").replace(/--[^\n]*/g,"");
  for(const m of clean.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?\s+([\s\S]*?);/gi))for(const c of m[2].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?/gi))out.push({table:m[1],column:c[1]});
  for(const m of clean.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\)\s*;/gi))for(const line of m[2].split(/,(?![^(]*\))/)){const col=line.trim().match(/^"?(\w+)"?\s+[a-z]/i);if(col&&!/^(constraint|primary|unique|foreign|check)$/i.test(col[1]))out.push({table:m[1],column:col[1]})}
  return out.filter(x=>PERSONAL_COLUMN.test(x.column)&&!NOT_PERSONAL.test(x.column));
}
export function unmappedPersonalColumns(detected:Array<{table:string;column:string}>,map:Array<{table_name:string;column_name:string}>){
  const known=new Set(map.map(x=>`${x.table_name}.${x.column_name}`.toLowerCase()));
  return detected.filter(x=>!known.has(`${x.table}.${x.column}`.toLowerCase()));
}

/* Metrics always carry their denominator. */
export function privacyMetrics(input:{requests:any[];consents:any[];unmappedFields:number;overdueRetention:number;openIncidents:number;now:Date}){
  const closed=input.requests.filter(r=>r.completed_at&&["fulfilled","partially_fulfilled","rejected_with_reason","closed"].includes(r.status));
  const withDue=closed.filter(r=>r.due_at),onTime=withDue.filter(r=>Date.parse(r.completed_at)<=Date.parse(r.due_at));
  const hours=closed.map(r=>(Date.parse(r.completed_at)-Date.parse(r.received_at||r.created_at))/36e5).filter(x=>x>=0).sort((a,b)=>a-b),mid=hours.length>>1;
  const rate=(a:number,b:number)=>b?Math.round(a/b*1000)/10:null;
  const revoked=input.consents.filter(c=>c.status==="revoked").length;
  return{
    dsrOnTimeRate:{value:rate(onTime.length,withDue.length),numerator:onTime.length,denominator:withDue.length,denominatorLabel:"solicitações concluídas com prazo"},
    medianDsrResolutionHours:{value:hours.length?Math.round((hours.length%2?hours[mid]:(hours[mid-1]+hours[mid])/2)*10)/10:null,denominator:hours.length,denominatorLabel:"solicitações concluídas"},
    consentRevocationRate:{value:rate(revoked,input.consents.length),numerator:revoked,denominator:input.consents.length,denominatorLabel:"registros de consentimento"},
    unmappedPersonalFieldCount:{value:input.unmappedFields,denominatorLabel:"sem denominador; é uma contagem"},
    overdueRetentionCount:{value:input.overdueRetention,denominatorLabel:"sem denominador; é uma contagem"},
    openPrivacyIncidentCount:{value:input.openIncidents,denominatorLabel:"sem denominador; é uma contagem"},
  };
}

// The assistant prepares and explains. These are the things it never does, whatever the prompt says.
export const PRIVACY_AI_FORBIDDEN=["execute_deletion","define_legal_basis","respond_to_subject_without_approval","decide_incident_notification"] as const;
export function assertHumanDecision(actor:{type:string}){if(actor.type!=="user")throw new Error("HUMAN_DECISION_REQUIRED")}

export const mustData=(result:{data:any;error:any},step:string):any=>{if(result.error)throw new Error(`${step}: ${result.error.message}`);return result.data};
