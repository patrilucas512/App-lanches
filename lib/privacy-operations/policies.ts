/* eslint-disable @typescript-eslint/no-explicit-any */
/* Privacy rules governed by the Policy Engine (Phase 79). This module only reads the active, published documents; writing,
   versioning, approving and auditing a policy stays in Phase 79. Without a policy, the Phase 95 settings apply unchanged. */
import {evaluateMany,resolveDecision,type EvaluationContext,type Policy,type TypedValue} from "../policy_engine/core.ts";
import {privacySettings} from "./server.ts";

export const PRIVACY_POLICY_KEYS={
  dsrDeadline:"privacy.dsr_deadline",dsrAlert:"privacy.dsr_alert",deletionApproval:"privacy.deletion_approval",
  verification:"privacy.identity_verification",retention:"privacy.retention_action",dpia:"privacy.dpia_required",incidentDeadline:"privacy.incident_notification_deadline",
} as const;

// Active privacy policies of one organization. A read failure is not a policy: it falls back to settings, and says so.
export async function activePrivacyPolicies(admin:any,organizationId:string|null):Promise<{policies:Policy[];available:boolean}>{
  if(!organizationId)return{policies:[],available:true};
  const{data,error}=await admin.from("policy_active_documents").select("policy_key,document").eq("organization_id",organizationId).like("policy_key","privacy.%");
  if(error)return{policies:[],available:false};
  return{policies:(data||[]).map((x:any)=>x.document as Policy).filter((p:any)=>p&&p.status==="active"),available:true};
}
const text=(value:unknown):TypedValue=>({type:"text",value:String(value??"")});
function evaluate(policies:Policy[],key:string,facts:Record<string,unknown>,storeId?:string|null){
  const relevant=policies.filter(p=>p.key===key);if(!relevant.length)return null;
  const context:EvaluationContext={facts:Object.fromEntries(Object.entries(facts).map(([k,v])=>[`evaluation_context:${k}`,text(v)])),scopeChain:[{type:"organization"},...(storeId?[{type:"store" as const,id:storeId}]:[])]};
  const details=evaluateMany(relevant,context);if(!details.length)return null;
  return{...resolveDecision(details),details};
}
const limitOf=(decision:any)=>{const o=(decision?.obligations||[]).find((x:any)=>x.type==="limit"&&x.value?.value!=null);const n=Number(o?.value?.value);return Number.isFinite(n)&&n>0?n:null};
const sourceOf=(decision:any)=>decision?.details?.[0]?{source:"policy" as const,policyId:decision.details[0].policyId,policyVersion:decision.details[0].policyVersion}:{source:"settings" as const};

export async function privacyRules(ctx:any){
  const[settings,{policies,available}]=await Promise.all([privacySettings(ctx.admin,ctx.contextId),activePrivacyPolicies(ctx.admin,ctx.organizationId)]);
  return{settings,policies,available,
    // Days to answer a request of this type. Policy first, then the context's settings.
    deadlineDays(type:string){const d=evaluate(policies,PRIVACY_POLICY_KEYS.dsrDeadline,{request_type:type},ctx.storeId),days=limitOf(d);if(days)return{days,...sourceOf(d)};const cfg=settings.dsr_deadline_days?.[type]??settings.dsr_deadline_days?.default;return{days:cfg==null?null:Number(cfg),source:"settings" as const}},
    alertDays(){const d=evaluate(policies,PRIVACY_POLICY_KEYS.dsrAlert,{},ctx.storeId),days=limitOf(d);return days??settings.dsr_alert_days_before},
    // Who may approve and execute. The floor never goes away: the requester never approves their own request.
    separation(action:"deletion"|"retention"){const d=evaluate(policies,PRIVACY_POLICY_KEYS.deletionApproval,{action},ctx.storeId),meta=(d?.obligations||[]).find((x:any)=>x.type==="approval")?.metadata||{};
      return{requiredApprovals:Math.max(1,Number(meta.requiredApprovals||1)),approverNotRequester:true,executorNotApprover:meta.executorMayApprove===true?false:!settings.self_approval_allowed,executorNotRequester:meta.requesterMayExecute===true?false:!settings.self_approval_allowed,...sourceOf(d)}},
    // A policy may only raise the identity check (for example to manual review), never remove it.
    verificationMethod(type:string,base:string){const d=evaluate(policies,PRIVACY_POLICY_KEYS.verification,{request_type:type},ctx.storeId),target=(d?.obligations||[]).find((x:any)=>x.type==="route")?.target;return target==="manual_review"?"manual_review":base},
    retentionRequiresApproval(dataset:string,policyFlag:boolean){const d=evaluate(policies,PRIVACY_POLICY_KEYS.retention,{dataset},ctx.storeId);return d?.decision==="require_approval"||policyFlag||settings.retention_requires_approval},
    dpiaByPolicy(facts:Record<string,unknown>){const d=evaluate(policies,PRIVACY_POLICY_KEYS.dpia,facts,ctx.storeId);return d?.decision==="require_review"||d?.decision==="require_approval"},
    incidentDeadlineDays(){const d=evaluate(policies,PRIVACY_POLICY_KEYS.incidentDeadline,{},ctx.storeId);return limitOf(d)??settings.incident_notification_deadline_days},
  };
}

/* Templates the DPO can import into Phase 79 as drafts. They reproduce today's settings, so publishing one changes nothing
   until someone edits it; the values stay marked as pending the DPO's review. */
const policy=(key:string,name:string,policyType:Policy["policyType"],rules:any[],risk:Policy["risk"]="high"):Policy=>({id:`template:${key}`,key,version:1,evaluatorVersion:"1.0.0",policyType,risk,status:"draft",evaluationMode:"priority",failMode:"require_manual_review",defaultEffect:"no_op",scope:{type:"organization",precedence:10},rules,auditMode:"full",...({name} as any)});
const limitRule=(id:string,days:number,conditions:any[]=[])=>({id,name:id,priority:conditions.length?200:100,enabled:true,effect:"set_limit",conditions:{id:`${id}-g`,mode:"all",conditions},obligations:[{type:"limit",value:{type:"integer",value:String(days)},metadata:{unit:"days",pendingDpoReview:true}}],explanation:`Prazo de ${days} dias (a validar pelo encarregado).`});
const typeIs=(type:string)=>({id:`type-${type}`,left:{source:"evaluation_context",key:"request_type"},operator:"equals",right:{source:"static_value",value:{type:"text",value:type}}});
export function privacyPolicyTemplates(settings:{dsr_deadline_days:Record<string,number|null>;dsr_alert_days_before:number}){
  const days=settings.dsr_deadline_days||{default:15};
  return[
    policy(PRIVACY_POLICY_KEYS.dsrDeadline,"Prazo de resposta a titulares","limit",[...Object.entries(days).filter(([k,v])=>k!=="default"&&v).map(([k,v])=>limitRule(`deadline-${k}`,Number(v),[typeIs(k)])),limitRule("deadline-default",Number(days.default||15))]),
    policy(PRIVACY_POLICY_KEYS.dsrAlert,"Alerta antes do prazo","limit",[limitRule("alert-default",Number(settings.dsr_alert_days_before||3))],"medium"),
    policy(PRIVACY_POLICY_KEYS.deletionApproval,"Aprovação de exclusão e retenção","approval",[{id:"approval-default",name:"approval-default",priority:100,enabled:true,effect:"require_approval",conditions:{id:"approval-g",mode:"all",conditions:[]},obligations:[{type:"approval",metadata:{requiredApprovals:1,executorMayApprove:false,requesterMayExecute:false}}],explanation:"Uma aprovação; quem pede, quem aprova e quem executa são pessoas diferentes."}],"critical"),
    policy(PRIVACY_POLICY_KEYS.incidentDeadline,"Prazo para comunicar incidente","limit",[],"critical"),
  ];
}

// "X requests change their deadline": what publishing a deadline policy would do to the open requests, before it goes live.
export async function previewDeadlineImpact(ctx:any,candidate:Policy){
  if(candidate?.key!==PRIVACY_POLICY_KEYS.dsrDeadline)throw new Error("POLICY_KEY_INVALID");
  const{data,error}=await ctx.admin.from("customer_privacy_requests").select("id,request_type,received_at,due_at,status").eq("context_id",ctx.contextId).not("status","in","(fulfilled,partially_fulfilled,rejected_with_reason,closed)").limit(5000);
  if(error)throw new Error(error.message);
  const active={...candidate,status:"active" as const},changes:any[]=[];
  for(const r of data||[]){const days=limitOf(evaluate([active],candidate.key,{request_type:r.request_type},ctx.storeId));if(!days)continue;
    const next=new Date(Date.parse(r.received_at)+days*864e5).toISOString();
    if(!r.due_at||Math.abs(Date.parse(r.due_at)-Date.parse(next))>6e4)changes.push({id:r.id,request_type:r.request_type,from:r.due_at,to:next})}
  return{open:(data||[]).length,changed:changes.length,earlier:changes.filter(c=>c.from&&c.to<c.from).length,changes:changes.slice(0,50)};
}
