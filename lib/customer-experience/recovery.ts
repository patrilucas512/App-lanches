/* eslint-disable @typescript-eslint/no-explicit-any */
/* Service recovery. No money moves here: the repository has no official refund flow, so an approved refund waits for manual execution at the gateway. */
import {createHash,randomBytes} from "node:crypto";
import {cxAudit,openRecoveryCase} from "./server.ts";

export const RECOVERY_ACTIONS=["human_contact","apology","refund_partial","refund_full","coupon","reship_item","schedule_follow_up"] as const;
export const COMPENSATION_ACTIONS=["refund_partial","refund_full","coupon"] as const;
const REFUNDS=["refund_partial","refund_full"];
const PRESSURE=/\b(remov|apag|mud|alter|retir|exclu)\w*\s+(a |sua |essa |esta )*(avalia[cç]|nota|coment[aá]rio|review)/i;
const TRANSITIONS:Record<string,string[]>={open:["contacted","in_progress","resolved","cancelled"],contacted:["in_progress","resolved","closed","cancelled"],in_progress:["contacted","resolved","closed","cancelled"],resolved:["closed","in_progress"],closed:[],cancelled:[]};

export class CompensationPolicyService{
  // A refund always needs a second person. Other compensation can pass under the configured limit, which starts at zero.
  evaluate(input:{actionType:string;amountCents:number;limitCents:number}){
    if(!(COMPENSATION_ACTIONS as readonly string[]).includes(input.actionType))return{isCompensation:false,needsApproval:false};
    if(REFUNDS.includes(input.actionType))return{isCompensation:true,needsApproval:true};
    return{isCompensation:true,needsApproval:input.amountCents>input.limitCents};
  }
  canDecide(input:{requestedBy?:string|null;actorId:string;permissions:string[]}){
    if(!input.permissions.includes("cx:approve_compensation"))return{allowed:false,reason:"FORBIDDEN"};
    if(input.requestedBy&&input.requestedBy===input.actorId)return{allowed:false,reason:"SELF_APPROVAL_BLOCKED"};
    return{allowed:true,reason:null};
  }
  // Never triggered by a score: this answers whether anything in the system may refund on its own, and the answer is no.
  autoRefundAllowed(){return false}
}

export const canTransitionCase=(from:string,to:string)=>(TRANSITIONS[from]||[]).includes(to);
export const pressuresCustomer=(text:string)=>PRESSURE.test(text);

async function loadCase(ctx:any,caseId:string){
  const{data}=await ctx.admin.from("service_recovery_cases").select("*").eq("id",caseId).eq("organization_id",ctx.organizationId).in("store_id",ctx.storeIds).maybeSingle();
  if(!data)throw new Error("CASE_NOT_FOUND");
  return data;
}

export async function openCaseManually(ctx:any,input:{feedbackId:string;reason:string;ownerId?:string|null}){
  if(input.reason.trim().length<3)throw new Error("REASON_REQUIRED");
  const{data:feedback}=await ctx.admin.from("crm_feedback").select("*").eq("id",input.feedbackId).eq("organization_id",ctx.organizationId).in("establishment_id",ctx.storeIds).maybeSingle();
  if(!feedback)throw new Error("FEEDBACK_NOT_FOUND");
  const{data:settings}=await ctx.admin.from("cx_settings").select("recovery_due_hours").eq("organization_id",ctx.organizationId).maybeSingle(),result=await openRecoveryCase(ctx,feedback,{reason:input.reason,ownerId:input.ownerId||ctx.actorId,dueHours:settings?.recovery_due_hours||24});
  if(result.created)await cxAudit(ctx.admin,{organizationId:ctx.organizationId,storeId:feedback.establishment_id,actorId:ctx.actorId,action:"recovery_opened",resourceType:"service_recovery_case",resourceId:result.recoveryCase.id});
  return result.recoveryCase;
}

export async function setCaseStatus(ctx:any,input:{caseId:string;status:string;outcome?:string|null;customerResponded?:boolean}){
  const current=await loadCase(ctx,input.caseId),now=new Date().toISOString();
  if(input.status!==current.status&&!canTransitionCase(current.status,input.status))throw new Error("TRANSITION_INVALID");
  if(input.status==="resolved"&&!input.outcome&&!current.outcome)throw new Error("OUTCOME_REQUIRED");
  const{data,error}=await ctx.admin.from("service_recovery_cases").update({status:input.status,outcome:input.outcome??current.outcome,resolved_at:["resolved","closed"].includes(input.status)?current.resolved_at||now:current.resolved_at,customer_responded_at:input.customerResponded?current.customer_responded_at||now:current.customer_responded_at,updated_at:now}).eq("id",current.id).select().single();
  if(error)throw new Error(error.message);
  if(input.status==="resolved")await ctx.admin.from("crm_feedback").update({inbox_status:"resolved",resolved_at:now}).eq("id",current.feedback_id);
  await cxAudit(ctx.admin,{organizationId:ctx.organizationId,storeId:current.store_id,actorId:ctx.actorId,action:"recovery_status_changed",resourceType:"service_recovery_case",resourceId:current.id,metadata:{status:input.status,outcome:input.outcome||null}});
  return data;
}

export async function recordRecoveryAction(ctx:any,input:{caseId:string;actionType:string;notes?:string;amountCents?:number;couponId?:string|null}){
  const current=await loadCase(ctx,input.caseId);
  if(!(RECOVERY_ACTIONS as readonly string[]).includes(input.actionType))throw new Error("ACTION_INVALID");
  if(["closed","cancelled"].includes(current.status))throw new Error("CASE_CLOSED");
  if(pressuresCustomer(String(input.notes||"")))throw new Error("PRESSURE_TO_CHANGE_REVIEW");
  const amount=Math.max(0,Math.round(Number(input.amountCents||0)));
  if(input.couponId){const{data:coupon}=await ctx.admin.from("coupons").select("id").eq("id",input.couponId).eq("establishment_id",current.store_id).eq("active",true).maybeSingle();if(!coupon)throw new Error("COUPON_NOT_FOUND")}
  if(input.actionType==="coupon"&&!input.couponId)throw new Error("COUPON_REQUIRED");
  if(REFUNDS.includes(input.actionType)&&amount<=0)throw new Error("AMOUNT_REQUIRED");
  const{data:settings}=await ctx.admin.from("cx_settings").select("compensation_limit_cents").eq("organization_id",ctx.organizationId).maybeSingle(),policy=new CompensationPolicyService().evaluate({actionType:input.actionType,amountCents:amount,limitCents:settings?.compensation_limit_cents||0}),now=new Date().toISOString(),status=!policy.isCompensation?"recorded":policy.needsApproval?"requested":"approved";
  const{data:action,error}=await ctx.admin.from("service_recovery_actions").insert({case_id:current.id,organization_id:ctx.organizationId,action_type:input.actionType,notes:input.notes||null,amount_cents:amount||null,coupon_id:input.couponId||null,status,requested_by:ctx.actorId,...(status==="approved"?{decided_at:now,decision_reason:"Dentro do limite configurado."}:{})}).select().single();
  if(error)throw new Error(error.message);
  if(current.status==="open"&&["human_contact","apology"].includes(input.actionType))await ctx.admin.from("service_recovery_cases").update({status:"contacted",updated_at:now}).eq("id",current.id);
  await cxAudit(ctx.admin,{organizationId:ctx.organizationId,storeId:current.store_id,actorId:ctx.actorId,action:policy.isCompensation?"compensation_requested":"recovery_action_recorded",resourceType:"service_recovery_action",resourceId:action.id,metadata:{action_type:input.actionType,amount_cents:amount||null,status}});
  return status==="approved"?executeCompensation(ctx,action,current):action;
}

export async function decideCompensation(ctx:any,input:{actionId:string;decision:"approved"|"rejected";reason:string}){
  const{data:action}=await ctx.admin.from("service_recovery_actions").select("*,service_recovery_cases(*)").eq("id",input.actionId).eq("organization_id",ctx.organizationId).maybeSingle();
  if(!action||!ctx.storeIds.includes(action.service_recovery_cases?.store_id))throw new Error("ACTION_NOT_FOUND");
  if(action.status!=="requested")throw new Error("ACTION_NOT_PENDING");
  if(input.reason.trim().length<3)throw new Error("REASON_REQUIRED");
  const decision=new CompensationPolicyService().canDecide({requestedBy:action.requested_by,actorId:ctx.actorId,permissions:ctx.permissions});
  if(!decision.allowed)throw new Error(String(decision.reason));
  const now=new Date().toISOString(),{data:updated,error}=await ctx.admin.from("service_recovery_actions").update({status:input.decision,decided_by:ctx.actorId,decided_at:now,decision_reason:input.reason,updated_at:now}).eq("id",action.id).eq("status","requested").select().single();
  if(error)throw new Error(error.message);
  await cxAudit(ctx.admin,{organizationId:ctx.organizationId,storeId:action.service_recovery_cases.store_id,actorId:ctx.actorId,action:`compensation_${input.decision}`,resourceType:"service_recovery_action",resourceId:action.id,reason:input.reason,metadata:{action_type:action.action_type,amount_cents:action.amount_cents}});
  return input.decision==="approved"?executeCompensation(ctx,updated,action.service_recovery_cases):updated;
}

async function executeCompensation(ctx:any,action:any,recoveryCase:any){
  const now=new Date().toISOString();
  if(REFUNDS.includes(action.action_type)){
    const{data}=await ctx.admin.from("service_recovery_actions").update({status:"awaiting_official_flow",updated_at:now}).eq("id",action.id).select().single();
    return data;
  }
  if(action.action_type==="coupon"){
    if(!recoveryCase.customer_id){const{data}=await ctx.admin.from("service_recovery_actions").update({status:"failed",failure_reason:"Avaliação sem cliente identificado.",updated_at:now}).eq("id",action.id).select().single();return data}
    const code=`CX${randomBytes(4).toString("hex").toUpperCase()}`,{error}=await ctx.admin.from("crm_coupon_tokens").insert({establishment_id:recoveryCase.store_id,coupon_id:action.coupon_id,customer_id:recoveryCase.customer_id,token_hash:createHash("sha256").update(code).digest("hex"),display_code:code});
    const{data}=await ctx.admin.from("service_recovery_actions").update(error?{status:"failed",failure_reason:String(error.message).slice(0,300),updated_at:now}:{status:"executed",notes:[action.notes,`Código ${code}`].filter(Boolean).join(" · "),updated_at:now}).eq("id",action.id).select().single();
    return data;
  }
  return action;
}

// Measures the outcome from Customer 360's source of truth: a completed order after the case opened, never a promise of causality.
export async function refreshRecoveryOutcomes(ctx:{admin:any;organizationId:string},limit=200){
  const{data:cases}=await ctx.admin.from("service_recovery_cases").select("id,customer_id,created_at").eq("organization_id",ctx.organizationId).is("repurchased_order_id",null).not("customer_id","is",null).limit(limit);let updated=0;
  for(const item of cases||[]){
    const{data:order}=await ctx.admin.from("orders").select("id,created_at").eq("customer_id",item.customer_id).eq("status","completed").gt("created_at",item.created_at).order("created_at").limit(1).maybeSingle();
    if(order){await ctx.admin.from("service_recovery_cases").update({repurchased_order_id:order.id,repurchased_at:order.created_at}).eq("id",item.id);updated++}
  }
  return{updated};
}
