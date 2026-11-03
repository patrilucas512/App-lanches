/* eslint-disable @typescript-eslint/no-explicit-any */
/* Orchestrated deletion: map → preview → approval → execution per domain → verification → evidence → answer.
   Nothing is removed before a person approves, legal holds and legal retention always win, and a domain that fails or still
   needs a manual step leaves the request partial. Steps can be re-run: they converge to the same state. */
import {aggregateExecution,canDeliverSubjectData,mustData,planDeletion,planSummary} from "./core.ts";
import {contextSalt,executeStep,locateSubjectData,resolveSubject,verifyStep} from "./adapters.ts";
import {dsrEvent,loadRequest,transitionRequest} from "./dsr.ts";
import {privacyAudit,privacySettings} from "./server.ts";

const MODE_OF:Record<string,"deletion"|"anonymization"|"blocking">={deletion:"deletion",anonymization:"anonymization",blocking:"blocking",opposition:"blocking"};
async function activeHolds(ctx:any){const{data}=await ctx.admin.from("legal_holds").select("scope_type,scope_ref,domain,status,valid_until,reason").eq("context_id",ctx.contextId).eq("status","active");return data||[]}

export async function previewDeletion(ctx:any,input:{requestId?:string|null;customerId?:string|null;organizationCustomerId?:string|null;mode?:string;retentionRunId?:string|null}){
  let request:any=null,mode=MODE_OF[String(input.mode)]||"deletion";
  if(input.requestId){request=await loadRequest(ctx,input.requestId);mode=MODE_OF[request.request_type]||mode;if(!["deletion","anonymization","blocking","opposition"].includes(request.request_type))throw new Error("REQUEST_TYPE_INVALID");
    if(["received","verifying"].includes(request.status)){await transitionRequest(ctx,{id:request.id,to:"in_progress",note:"Prévia de exclusão gerada."});request=await loadRequest(ctx,request.id)}}
  const subject=await resolveSubject(ctx.admin,{contextId:ctx.contextId,organizationId:ctx.organizationId,customerId:request?.customer_id||input.customerId,organizationCustomerId:request?.organization_customer_id||input.organizationCustomerId});
  if(!subject)throw new Error("SUBJECT_NOT_FOUND");
  const[records,holds]=await Promise.all([locateSubjectData(ctx.admin,subject),activeHolds(ctx)]);
  const items=planDeletion({records,holds,subjectRef:subject.subjectRef,mode,now:new Date()}),summary=planSummary(items);
  const plan=mustData(await ctx.admin.from("privacy_deletion_plans").insert({context_id:ctx.contextId,request_id:request?.id||null,retention_run_id:input.retentionRunId||null,subject_ref:subject.subjectRef,mode,summary,requested_by:ctx.actorId||null}).select().single(),"plano");
  const steps=items.map(x=>({plan_id:plan.id,context_id:ctx.contextId,domain:x.domain,table_name:x.table,record_ref:x.recordId,decision:x.decision,reason:x.reason,status:x.decision==="manual"?"manual_pending":"queued"}));
  for(let i=0;i<steps.length;i+=500)mustData(await ctx.admin.from("privacy_deletion_steps").insert(steps.slice(i,i+500)).select("id"),"passos");
  if(request){await ctx.admin.from("customer_privacy_requests").update({affected_domains:[...new Set(items.map(x=>x.domain))],updated_at:new Date().toISOString()}).eq("id",request.id);await dsrEvent(ctx,request,{type:"deletion_previewed",evidence:{plan_id:plan.id,summary}})}
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:"deletion_previewed",resourceType:"privacy_deletion_plan",resourceId:plan.id,metadata:{mode,summary}});
  // The preview lists what goes, what is anonymized and what stays, with the reason; never the values themselves.
  const byDomain:Record<string,any>={};for(const x of items){const d=byDomain[x.domain]||={delete:0,anonymize:0,retain:0,block:0,manual:0,reasons:new Set<string>()};d[x.decision==="anonymize_link"?"anonymize":x.decision]++;d.reasons.add(x.reason)}
  return{plan:{id:plan.id,mode,summary},domains:Object.entries(byDomain).map(([domain,d]:any)=>({domain,delete:d.delete,anonymize:d.anonymize,retain:d.retain,block:d.block,manual:d.manual,reasons:[...d.reasons]}))};
}

export async function requestPlanApproval(ctx:any,input:{planId:string}){
  const plan=mustData(await ctx.admin.from("privacy_deletion_plans").select("*").eq("id",input.planId).eq("context_id",ctx.contextId).single(),"plano");
  if(plan.status!=="previewed")throw new Error("STATUS_INVALID");
  const approval=mustData(await ctx.admin.from("internal_approvals").insert({approval_type:"privacy_deletion",title:`Exclusão/anonimização de dados de titular (${plan.mode})`,description:`Apagar: ${plan.summary.delete||0}. Anonimizar: ${plan.summary.anonymize||0}. Manter por lei: ${plan.summary.retain||0}. Manual: ${plan.summary.manual||0}.`,source_type:"privacy_deletion_plan",source_id:plan.id,status:"pending",required_approvals:1,risk_level:"high",requested_by:ctx.actorId}).select().single(),"aprovação");
  await ctx.admin.from("privacy_deletion_plans").update({status:"awaiting_approval",approval_id:approval.id,updated_at:new Date().toISOString()}).eq("id",plan.id);
  if(plan.request_id){const request=await loadRequest(ctx,plan.request_id);if(request.status==="in_progress")await transitionRequest(ctx,{id:request.id,to:"awaiting_approval",note:"Prévia enviada para aprovação."})}
  return{approval_id:approval.id};
}

// A different person approves, unless the context explicitly allows self-approval. AI never decides here.
export async function decidePlan(ctx:any,input:{planId:string;decision:"approved"|"rejected";reason:string}){
  if(ctx.actorType&&ctx.actorType!=="user")throw new Error("HUMAN_DECISION_REQUIRED");
  if(String(input.reason||"").trim().length<5)throw new Error("REASON_REQUIRED");
  const[plan,settings]=await Promise.all([ctx.admin.from("privacy_deletion_plans").select("*").eq("id",input.planId).eq("context_id",ctx.contextId).single().then((r:any)=>mustData(r,"plano")),privacySettings(ctx.admin,ctx.contextId)]);
  if(plan.status!=="awaiting_approval")throw new Error("STATUS_INVALID");
  if(!settings.self_approval_allowed&&plan.requested_by===ctx.actorId)throw new Error("SELF_APPROVAL_BLOCKED");
  const now=new Date().toISOString(),approved=input.decision==="approved";
  await ctx.admin.from("internal_approval_steps").insert({approval_id:plan.approval_id,approver_user_id:ctx.actorId,decision:input.decision,reason:input.reason,decided_at:now});
  await ctx.admin.from("internal_approvals").update({status:input.decision,resolved_at:now,resolution_reason:input.reason,approver_user_id:ctx.actorId,updated_at:now}).eq("id",plan.approval_id);
  await ctx.admin.from("privacy_deletion_plans").update({status:approved?"approved":"cancelled",approved_by:approved?ctx.actorId:null,updated_at:now}).eq("id",plan.id);
  if(plan.request_id&&!approved){const request=await loadRequest(ctx,plan.request_id);if(request.status==="awaiting_approval")await transitionRequest(ctx,{id:request.id,to:"in_progress",note:`Plano recusado: ${input.reason}`})}
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:approved?"deletion_approved":"deletion_rejected",resourceType:"privacy_deletion_plan",resourceId:plan.id,reason:input.reason});
  return{status:approved?"approved":"cancelled"};
}

export async function executePlan(ctx:any,input:{planId:string;limit?:number}){
  if(ctx.actorType&&!["user","system"].includes(ctx.actorType))throw new Error("HUMAN_DECISION_REQUIRED");
  const plan=mustData(await ctx.admin.from("privacy_deletion_plans").select("*").eq("id",input.planId).eq("context_id",ctx.contextId).single(),"plano");
  if(!["approved","running","partially_completed"].includes(plan.status))throw new Error("APPROVAL_REQUIRED");
  // A subject's request is only acted on after the identity check; retention runs have no subject asking.
  if(plan.request_id&&!canDeliverSubjectData(await loadRequest(ctx,plan.request_id)))throw new Error("VERIFICATION_REQUIRED");
  await ctx.admin.from("privacy_deletion_plans").update({status:"running",executed_by:plan.executed_by||ctx.actorId,updated_at:new Date().toISOString()}).eq("id",plan.id);
  // Holds created after the preview still win: their domains are skipped now.
  const holds=await activeHolds(ctx),heldDomains=new Set(holds.filter((h:any)=>h.scope_type==="dataset").map((h:any)=>h.domain||h.scope_ref)),subjectHeld=holds.some((h:any)=>h.scope_type==="subject"&&h.scope_ref===plan.subject_ref);
  const salt=await contextSalt(ctx.admin,ctx.contextId);
  const{data:pending}=await ctx.admin.from("privacy_deletion_steps").select("*").eq("plan_id",plan.id).in("status",["queued","running","failed","completed"]).neq("decision","manual").lt("attempts",5).order("created_at").limit(Math.min(input.limit||500,1000));
  let done=0,failed=0;
  for(const step of pending||[]){
    const now=new Date().toISOString();
    if(subjectHeld||heldDomains.has(step.domain)){await ctx.admin.from("privacy_deletion_steps").update({status:"skipped_retained",reason:"legal_hold",executed_at:now}).eq("id",step.id);continue}
    try{
      if(step.status!=="completed"){await ctx.admin.from("privacy_deletion_steps").update({status:"running",attempts:step.attempts+1}).eq("id",step.id);const result=await executeStep(ctx.admin,step,salt);
        if(result.status==="skipped_retained"){await ctx.admin.from("privacy_deletion_steps").update({status:"skipped_retained",executed_at:now}).eq("id",step.id);continue}}
      const ok=await verifyStep(ctx.admin,step);
      await ctx.admin.from("privacy_deletion_steps").update(ok?{status:"verified",executed_at:step.executed_at||now,verified_at:now,error_code:null}:{status:"failed",error_code:"VERIFICATION_FAILED"}).eq("id",step.id);
      if(ok)done++;else failed++;
    }catch(error:any){await ctx.admin.from("privacy_deletion_steps").update({status:"failed",error_code:String(error?.message||"FAILED").slice(0,120)}).eq("id",step.id);failed++}
  }
  return finalizePlan(ctx,plan,{done,failed});
}

async function finalizePlan(ctx:any,plan:any,counts:{done:number;failed:number}){
  const{data:steps}=await ctx.admin.from("privacy_deletion_steps").select("domain,status,decision").eq("plan_id",plan.id).limit(20000);
  const all=steps||[],outcome=aggregateExecution(all.map((s:any)=>({status:s.status==="manual_pending"?"manual_pending":s.status}))),now=new Date().toISOString();
  const open=[...new Set(all.filter((s:any)=>!["verified","completed","skipped_retained"].includes(s.status)).map((s:any)=>s.domain))];
  const retained=[...new Set(all.filter((s:any)=>s.status==="skipped_retained").map((s:any)=>s.domain))];
  const status=outcome==="fulfilled"?"completed":outcome==="in_progress"?"running":"partially_completed";
  await ctx.admin.from("privacy_deletion_plans").update({status,completed_at:status==="completed"?now:null,updated_at:now}).eq("id",plan.id);
  // The evidence says what happened per domain. It does not contain any of the removed values.
  const evidence={plan_id:plan.id,verified:all.filter((s:any)=>s.status==="verified").length,retained_domains:retained,open_domains:open,backup_notice:"Cópias em backup expiram pela política de retenção de backups (Fase 25); não há remoção imediata."};
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId||null,actorType:ctx.actorType||"user",action:"deletion_executed",resourceType:"privacy_deletion_plan",resourceId:plan.id,metadata:{status,processed:counts.done,failed:counts.failed,retained_domains:retained,open_domains:open}});
  if(plan.request_id&&status!=="running"){const request=await loadRequest(ctx,plan.request_id);await dsrEvent(ctx,request,{type:"deletion_executed",evidence});
    const target=status==="completed"?"fulfilled":"partially_fulfilled";
    if(request.status!==target&&["in_progress","awaiting_approval","partially_fulfilled"].includes(request.status)){
      if(request.status==="partially_fulfilled"&&target==="partially_fulfilled"){/* already partial; the timeline has the new evidence */}
      else{if(request.status==="partially_fulfilled")await transitionRequest(ctx,{id:request.id,to:"in_progress",note:"Retomada da execução."});
        await transitionRequest(ctx,{id:request.id,to:target,reason:target==="partially_fulfilled"?`Pendente em: ${open.join(", ")||"—"}. Mantido por obrigação legal ou bloqueio: ${retained.join(", ")||"—"}.`:null,outcome:evidence})}}}
  return{status,processed:counts.done,failed:counts.failed,open_domains:open,retained_domains:retained};
}

// A manual step (a domain without adapter) is closed by a person who says what was done there.
export async function confirmManualStep(ctx:any,input:{stepId:string;note:string}){
  if(String(input.note||"").trim().length<10)throw new Error("REASON_REQUIRED");
  const step=mustData(await ctx.admin.from("privacy_deletion_steps").select("*").eq("id",input.stepId).eq("context_id",ctx.contextId).eq("status","manual_pending").single(),"passo");
  await ctx.admin.from("privacy_deletion_steps").update({status:"completed",executed_at:new Date().toISOString(),reason:`${step.reason}; manual: ${String(input.note).slice(0,300)}`}).eq("id",step.id);
  const plan=mustData(await ctx.admin.from("privacy_deletion_plans").select("*").eq("id",step.plan_id).single(),"plano");
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:"deletion_manual_step_confirmed",resourceType:"privacy_deletion_step",resourceId:step.id,metadata:{domain:step.domain}});
  return finalizePlan(ctx,plan,{done:1,failed:0});
}
