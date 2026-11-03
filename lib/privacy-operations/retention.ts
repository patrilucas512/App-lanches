/* eslint-disable @typescript-eslint/no-explicit-any */
/* Retention policies, controlled runs and legal holds. A run is a dry run unless the execution flag is on and, when the
   policy asks, a person approved it. Held records are skipped and listed in the run report. */
import {HOLD_REASONS,RETENTION_ACTIONS,RETENTION_TRIGGERS,holdNeedsReview,mustData,retentionDue,retentionRunGate} from "./core.ts";
import {executePlan,previewDeletion} from "./deletion.ts";
import {privacyAudit,privacySettings} from "./server.ts";

// Datasets with an executor today. Others can hold a policy (and show in the ROPA) but a run reports them as not executable.
export const RETENTION_DATASETS:Record<string,{label:string;triggers:string[]}>={
  inactive_customers:{label:"Clientes sem pedidos (cadastro e vínculos pessoais)",triggers:["after_last_order","after_created"]},
};

export async function savePolicy(ctx:any,input:any){
  const row:any={name:String(input.name||"").trim().slice(0,120),domain:String(input.domain||"customers"),dataset:String(input.dataset||""),data_category:input.data_category||null,period_days:Number(input.period_days),trigger:input.trigger,action:input.action,basis:String(input.basis||"").trim(),requires_approval:input.requires_approval!==false,owner_user_id:input.owner_user_id||ctx.actorId,status:["active","paused","retired"].includes(input.status)?input.status:"draft",updated_at:new Date().toISOString()};
  if(row.name.length<3||!row.dataset)throw new Error("POLICY_INVALID");
  if(!(row.period_days>0))throw new Error("PERIOD_INVALID");
  if(!(RETENTION_TRIGGERS as readonly string[]).includes(row.trigger)||!(RETENTION_ACTIONS as readonly string[]).includes(row.action))throw new Error("POLICY_INVALID");
  if(row.basis.length<5)throw new Error("BASIS_REQUIRED");
  const saved=mustData(input.id?await ctx.admin.from("retention_policies").update(row).eq("id",input.id).eq("context_id",ctx.contextId).select().single():await ctx.admin.from("retention_policies").insert({...row,context_id:ctx.contextId,created_by:ctx.actorId}).select().single(),"política");
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:"retention_policy_saved",resourceType:"retention_policy",resourceId:saved.id,metadata:{dataset:row.dataset,period_days:row.period_days,action:row.action,status:row.status}});
  return saved;
}

async function dueInactiveCustomers(ctx:any,policy:any,now:Date,limit:number){
  const{data:stores}=await ctx.admin.from("establishments").select("id").eq("organization_id",ctx.organizationId);
  const cutoff=new Date(now.getTime()-policy.period_days*864e5).toISOString(),column=policy.trigger==="after_created"?"created_at":"last_order_at";
  const{data,error}=await ctx.admin.from("customers").select("id,organization_customer_id,created_at,last_order_at,name").in("establishment_id",(stores||[]).map((s:any)=>s.id)).lt(column,cutoff).neq("name","Cliente anonimizado").limit(limit);
  if(error)throw new Error(error.message);
  return(data||[]).filter((c:any)=>retentionDue(policy,c,now));
}

export async function runRetention(ctx:any,input:{policyId:string;mode:"dry_run"|"execute";runId?:string|null;now?:Date;limit?:number}){
  const now=input.now||new Date(),limit=Math.min(input.limit||200,500);
  const policy=mustData(await ctx.admin.from("retention_policies").select("*").eq("id",input.policyId).eq("context_id",ctx.contextId).single(),"política");
  if(input.mode==="execute"&&policy.status!=="active")throw new Error("POLICY_NOT_ACTIVE");
  const settings=await privacySettings(ctx.admin,ctx.contextId);
  let run:any=null;
  if(input.runId)run=mustData(await ctx.admin.from("retention_runs").select("*").eq("id",input.runId).eq("context_id",ctx.contextId).single(),"execução");
  const{data:approval}=run?.approval_id?await ctx.admin.from("internal_approvals").select("status").eq("id",run.approval_id).maybeSingle():{data:null};
  const gate=retentionRunGate({mode:input.mode,executionFlag:ctx.flags?.privacy_retention_execution_enabled===true,approvalStatus:approval?.status,requiresApproval:policy.requires_approval||settings.retention_requires_approval});
  if(!gate.allowed)throw new Error((gate.issues||[]).join(","));
  if(!RETENTION_DATASETS[policy.dataset]){
    const report={executable:false,reason:"DATASET_WITHOUT_EXECUTOR",dataset:policy.dataset};
    run=mustData(await ctx.admin.from("retention_runs").insert({context_id:ctx.contextId,policy_id:policy.id,mode:"dry_run",status:"completed",report,requested_by:ctx.actorId,completed_at:now.toISOString()}).select().single(),"execução");
    return{run,report};
  }
  const due=await dueInactiveCustomers(ctx,policy,now,limit);
  const{data:holds}=await ctx.admin.from("legal_holds").select("scope_type,scope_ref,domain,valid_until,reason").eq("context_id",ctx.contextId).eq("status","active");
  const live=(holds||[]).filter((h:any)=>!h.valid_until||Date.parse(h.valid_until)>now.getTime());
  const datasetHeld=live.some((h:any)=>h.scope_type==="dataset"&&(h.domain===policy.domain||h.scope_ref===policy.dataset));
  const held=(c:any)=>datasetHeld||live.some((h:any)=>h.scope_type==="subject"&&[c.organization_customer_id,c.id].includes(h.scope_ref));
  if(!run)run=mustData(await ctx.admin.from("retention_runs").insert({context_id:ctx.contextId,policy_id:policy.id,mode:input.mode,status:input.mode==="dry_run"?"previewed":"running",requested_by:ctx.actorId,started_at:now.toISOString()}).select().single(),"execução");
  const items=due.map((c:any)=>({run_id:run.id,context_id:ctx.contextId,record_ref:String(c.organization_customer_id||c.id),decision:held(c)?"held":"due",reason:held(c)?"legal_hold":`${policy.trigger}>${policy.period_days}d`}));
  const unique=[...new Map(items.map((x:any)=>[x.record_ref,x])).values()],customerOf=new Map(due.map((c:any)=>[String(c.organization_customer_id||c.id),String(c.id)]));
  if(unique.length)await ctx.admin.from("retention_run_items").upsert(unique,{onConflict:"run_id,record_ref",ignoreDuplicates:true});
  const heldCount=unique.filter((x:any)=>x.decision==="held").length;
  // A dry run writes only its own report. Nothing in the customer data changes.
  if(input.mode==="dry_run"||policy.action==="review"||policy.action==="archive"){
    const report={executable:true,due:unique.length-heldCount,held:heldCount,action:policy.action,note:policy.action==="review"?"Revisão: ninguém é alterado automaticamente.":policy.action==="archive"?"Arquivamento ainda sem executor; use anonimizar ou excluir.":"Simulação: nenhum dado foi alterado."};
    run=mustData(await ctx.admin.from("retention_runs").update({status:"previewed",due_count:report.due,held_count:heldCount,report,completed_at:new Date().toISOString()}).eq("id",run.id).select().single(),"execução");
    await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:"retention_previewed",resourceType:"retention_run",resourceId:run.id,metadata:report});
    return{run,report};
  }
  let processed=0,failed=0;
  for(const item of unique.filter((x:any)=>x.decision==="due")){
    try{const preview=await previewDeletion(ctx,{customerId:customerOf.get(item.record_ref),mode:policy.action==="delete"?"deletion":"anonymization",retentionRunId:run.id});
      await ctx.admin.from("privacy_deletion_plans").update({status:"approved",approval_id:run.approval_id,approved_by:null}).eq("id",preview.plan.id);
      const result=await executePlan({...ctx,actorType:"system"},{planId:preview.plan.id});
      await ctx.admin.from("retention_run_items").update({decision:result.status==="completed"?"processed":"failed",reason:result.status}).eq("run_id",run.id).eq("record_ref",item.record_ref);
      result.status==="completed"?processed++:failed++;
    }catch(error:any){await ctx.admin.from("retention_run_items").update({decision:"failed",reason:String(error?.message||"FAILED").slice(0,120)}).eq("run_id",run.id).eq("record_ref",item.record_ref);failed++}
  }
  const report={executable:true,due:unique.length-heldCount,held:heldCount,processed,failed,action:policy.action};
  run=mustData(await ctx.admin.from("retention_runs").update({status:failed?"partially_completed":"completed",due_count:report.due,held_count:heldCount,processed_count:processed,failed_count:failed,report,completed_at:new Date().toISOString()}).eq("id",run.id).select().single(),"execução");
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:"retention_executed",resourceType:"retention_run",resourceId:run.id,metadata:report});
  return{run,report};
}

// A real run is requested first, approved by someone else, and only then executed with the same run id.
export async function requestRetentionRun(ctx:any,input:{policyId:string}){
  const policy=mustData(await ctx.admin.from("retention_policies").select("*").eq("id",input.policyId).eq("context_id",ctx.contextId).single(),"política");
  const approval=mustData(await ctx.admin.from("internal_approvals").insert({approval_type:"privacy_retention_run",title:`Execução de retenção: ${policy.name}`,description:`Ação ${policy.action} após ${policy.period_days} dias (${policy.trigger}).`,source_type:"retention_policy",source_id:policy.id,status:"pending",required_approvals:1,risk_level:"high",requested_by:ctx.actorId}).select().single(),"aprovação");
  const run=mustData(await ctx.admin.from("retention_runs").insert({context_id:ctx.contextId,policy_id:policy.id,mode:"execute",status:"awaiting_approval",approval_id:approval.id,requested_by:ctx.actorId}).select().single(),"execução");
  return{run};
}
export async function decideRetentionRun(ctx:any,input:{runId:string;decision:"approved"|"rejected";reason:string}){
  if(String(input.reason||"").trim().length<5)throw new Error("REASON_REQUIRED");
  const run=mustData(await ctx.admin.from("retention_runs").select("*").eq("id",input.runId).eq("context_id",ctx.contextId).eq("status","awaiting_approval").single(),"execução");
  const settings=await privacySettings(ctx.admin,ctx.contextId);
  if(!settings.self_approval_allowed&&run.requested_by===ctx.actorId)throw new Error("SELF_APPROVAL_BLOCKED");
  const now=new Date().toISOString();
  await ctx.admin.from("internal_approval_steps").insert({approval_id:run.approval_id,approver_user_id:ctx.actorId,decision:input.decision,reason:input.reason,decided_at:now});
  await ctx.admin.from("internal_approvals").update({status:input.decision,resolved_at:now,resolution_reason:input.reason,approver_user_id:ctx.actorId,updated_at:now}).eq("id",run.approval_id);
  if(input.decision==="rejected")await ctx.admin.from("retention_runs").update({status:"cancelled",completed_at:now}).eq("id",run.id);
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:`retention_run_${input.decision}`,resourceType:"retention_run",resourceId:run.id,reason:input.reason});
  return{status:input.decision};
}

export async function createHold(ctx:any,input:any){
  if(!(HOLD_REASONS as readonly string[]).includes(input.reason))throw new Error("HOLD_REASON_INVALID");
  if(!["subject","dataset","case"].includes(input.scope_type))throw new Error("HOLD_SCOPE_INVALID");
  if(String(input.basis||"").trim().length<5)throw new Error("BASIS_REQUIRED");
  const hold=mustData(await ctx.admin.from("legal_holds").insert({context_id:ctx.contextId,scope_type:input.scope_type,scope_ref:input.scope_ref||null,domain:input.domain||null,reason:input.reason,basis:String(input.basis).slice(0,500),owner_user_id:input.owner_user_id||ctx.actorId,valid_until:input.valid_until||null,created_by:ctx.actorId}).select().single(),"bloqueio legal");
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:"legal_hold_created",resourceType:"legal_hold",resourceId:hold.id,metadata:{scope:hold.scope_type,domain:hold.domain,reason:hold.reason,valid_until:hold.valid_until}});
  return hold;
}
export async function releaseHold(ctx:any,input:{id:string;reason:string}){
  if(String(input.reason||"").trim().length<10)throw new Error("REASON_REQUIRED");
  const now=new Date().toISOString(),hold=mustData(await ctx.admin.from("legal_holds").update({status:"released",released_reason:input.reason,released_by:ctx.actorId,released_at:now,updated_at:now}).eq("id",input.id).eq("context_id",ctx.contextId).eq("status","active").select().single(),"bloqueio legal");
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:"legal_hold_released",resourceType:"legal_hold",resourceId:hold.id,reason:input.reason});
  return hold;
}
export async function reviewHold(ctx:any,input:{id:string;note?:string}){
  const now=new Date().toISOString(),hold=mustData(await ctx.admin.from("legal_holds").update({last_reviewed_at:now,updated_at:now}).eq("id",input.id).eq("context_id",ctx.contextId).eq("status","active").select().single(),"bloqueio legal");
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:"legal_hold_reviewed",resourceType:"legal_hold",resourceId:hold.id,reason:input.note||null});
  return hold;
}
export async function holdsDueForReview(ctx:any,now=new Date()){
  const[settings,{data}]=await Promise.all([privacySettings(ctx.admin,ctx.contextId),ctx.admin.from("legal_holds").select("*").eq("context_id",ctx.contextId).eq("status","active").limit(1000)]);
  return(data||[]).filter((h:any)=>holdNeedsReview(h,now,settings.hold_review_days));
}
