/* eslint-disable @typescript-eslint/no-explicit-any */
/* Requests and lifecycle: request -> policy -> SoD -> Phase 32 approval -> rbac_* facade -> verification -> audit and SOC event. */
import {approvalState} from "../internal-work/core.ts";
import {evaluateMany,resolveDecision,type Policy} from "../policy_engine/core.ts";
import {openGovernedAction} from "./actions.ts";
import {scopeKeyOf} from "./core.ts";
import {AccessProvisioningService} from "./provisioning.ts";
import {AccessLifecycleService,AccessRequestService,TemporaryAccessService,type PolicyGate} from "./rules.ts";
import {governanceAudit,readEffectiveAccess,syncIdentities} from "./server.ts";
import {emitIdentityEvent} from "./soc-events.ts";
import {checkPreventiveSod} from "./sod.ts";

export type GovernanceContext={admin:any;organizationId:string;storeId?:string;actorId:string|null;aal?:string|null;notify?:(admin:any,event:any)=>Promise<unknown>};
const ACCESS_POLICY_KEY="identity.access_request";

// Fails toward more control: without a usable policy, catalog rules apply and privileged access still needs approval.
export async function evaluateAccessPolicy(admin:any,organizationId:string,facts:Record<string,string|boolean>):Promise<PolicyGate>{
  try{
    const{data,error}=await admin.from("policy_active_documents").select("document").eq("organization_id",organizationId).eq("policy_key",ACCESS_POLICY_KEY);
    if(error)return{decision:"not_applicable",available:false};
    const context={facts:Object.fromEntries(Object.entries(facts).map(([k,v])=>[`evaluation_context:${k}`,typeof v==="boolean"?{type:"boolean",value:v}:{type:"text",value:v}])) as any},resolved=resolveDecision(evaluateMany((data||[]).map((x:any)=>x.document as Policy),context));
    return{decision:resolved.decision,source:resolved.source,available:true};
  }catch{return{decision:"not_applicable",available:false}}
}

const loadRequestParts=async(ctx:GovernanceContext,identityId:string,entitlementId:string)=>{
  const[{data:identity},{data:entitlement}]=await Promise.all([ctx.admin.from("governed_identities").select("*").eq("id",identityId).eq("organization_id",ctx.organizationId).maybeSingle(),ctx.admin.from("access_entitlements").select("*").eq("id",entitlementId).eq("organization_id",ctx.organizationId).maybeSingle()]);
  if(!identity||!entitlement)throw new Error("IDENTITY_OR_ENTITLEMENT_NOT_IN_TENANT");
  return{identity,entitlement};
};

export async function createAccessRequest(ctx:GovernanceContext,input:{identityId:string;entitlementId:string;scope?:{establishment_id?:string};justification:string;durationHours?:number|null;requestType?:string;changeRef?:string|null;incidentRef?:string|null;idempotencyKey:string}){
  const requester=ctx.actorId as string,requestType=input.requestType||"new_access",scope=input.scope||{},service=new AccessRequestService();
  const{data:existing}=await ctx.admin.from("access_requests").select("*").eq("organization_id",ctx.organizationId).eq("idempotency_key",input.idempotencyKey).maybeSingle();
  if(existing)return{request:existing,deduplicated:true};
  const{identity,entitlement}=await loadRequestParts(ctx,input.identityId,input.entitlementId);
  if(scope.establishment_id){const{data:store}=await ctx.admin.from("establishments").select("id").eq("id",scope.establishment_id).eq("organization_id",ctx.organizationId).maybeSingle();if(!store)throw new Error("SCOPE_NOT_IN_TENANT")}
  const validation=service.validate({entitlement,justification:input.justification,durationHours:input.durationHours,requestType});
  if(!validation.valid)throw new Error(validation.issues.join(","));
  const{data:settings}=await ctx.admin.from("identity_governance_settings").select("production_access_requires_change").eq("organization_id",ctx.organizationId).maybeSingle();
  const policy=await evaluateAccessPolicy(ctx.admin,ctx.organizationId,{entitlement_key:entitlement.key,criticality:entitlement.criticality,privileged:entitlement.privileged,identity_type:identity.identity_type,request_type:requestType});
  const sod=requestType==="removal"?{result:"no_conflict",conflicts:[],blocking:[]}:await checkPreventiveSod(ctx,{identity,entitlement});
  const route=service.route({criticality:entitlement.criticality,privileged:entitlement.privileged,policy,sodResult:sod.result,environmentAccess:entitlement.entitlement_type==="environment_access",productionRequiresChange:settings?.production_access_requires_change});
  const base={organization_id:ctx.organizationId,requester_id:requester,beneficiary_identity_id:identity.id,entitlement_id:entitlement.id,scope,scope_key:scopeKeyOf(scope),justification:input.justification,requested_duration:input.durationHours?`${input.durationHours} hours`:null,request_type:requestType,linked_change_ref:input.changeRef||null,linked_incident_ref:input.incidentRef||null,policy_decision:{...policy,route:route.reasons},sod_result:sod.result,sod_conflicts:sod.conflicts,idempotency_key:input.idempotencyKey};
  const rejectWith=async(reason:string,detail:Record<string,unknown>)=>{const{data,error}=await ctx.admin.from("access_requests").insert({...base,status:"rejected",failure_reason:reason}).select().single();if(error)throw new Error(error.message);await governanceAudit(ctx.admin,{organizationId:ctx.organizationId,actorId:requester,action:"request_rejected",resourceType:"access_request",resourceId:data.id,reason,metadata:detail});return{request:data,blocked:reason}};
  if(route.outcome==="deny")return rejectWith("POLICY_DENIED",{policy});
  if(sod.result==="conflict_blocked")return rejectWith("SOD_CONFLICT_BLOCKED",{conflicts:sod.blocking});
  if(route.requiresChange&&!input.changeRef)return rejectWith("APPROVED_CHANGE_REQUIRED",{});
  if(route.requiresChange){const{data:change}=await ctx.admin.from("change_requests").select("status").eq("id",input.changeRef).eq("organization_id",ctx.organizationId).maybeSingle();if(!change||!["approved","scheduled","implementing"].includes(change.status))return rejectWith("APPROVED_CHANGE_REQUIRED",{change_status:change?.status||null})}
  const{data:request,error}=await ctx.admin.from("access_requests").insert({...base,status:"submitted"}).select().single();
  if(error)throw new Error(error.message);
  await governanceAudit(ctx.admin,{organizationId:ctx.organizationId,actorId:requester,action:"request_submitted",resourceType:"access_request",resourceId:request.id,reason:input.justification,metadata:{entitlement:entitlement.key,required_approvals:route.requiredApprovals,sod:sod.result}});
  if(route.requiredApprovals===0)return{request:await executeApprovedRequest(ctx,request,entitlement,identity,[]),preApproved:true};
  const{data:approval,error:approvalError}=await ctx.admin.from("internal_approvals").insert({approval_type:"identity_access_request",title:`Acesso: ${entitlement.name}`,description:input.justification,source_type:"identity_access_request",source_id:request.id,status:"pending",required_approvals:route.requiredApprovals,risk_level:entitlement.criticality,requested_by:requester}).select("id").single();
  if(approvalError)throw new Error(approvalError.message);
  const{data:updated}=await ctx.admin.from("access_requests").update({status:"pending_approval",approval_id:approval.id,updated_at:new Date().toISOString()}).eq("id",request.id).select().single();
  return{request:updated,requiredApprovals:route.requiredApprovals};
}

export async function decideAccessRequest(ctx:GovernanceContext,input:{requestId:string;decision:"approved"|"rejected";reason:string}){
  const approver=ctx.actorId as string;
  const{data:request}=await ctx.admin.from("access_requests").select("*").eq("id",input.requestId).eq("organization_id",ctx.organizationId).maybeSingle();
  if(!request)throw new Error("REQUEST_NOT_FOUND");
  if(request.status!=="pending_approval")throw new Error("REQUEST_NOT_PENDING");
  const{identity,entitlement}=await loadRequestParts(ctx,request.beneficiary_identity_id,request.entitlement_id);
  const{data:steps}=await ctx.admin.from("internal_approval_steps").select("approver_user_id,decision").eq("approval_id",request.approval_id);
  const check=new AccessRequestService().canApprove({approverId:approver,requesterId:request.requester_id,beneficiaryUserId:identity.user_id,alreadyApproved:(steps||[]).map((x:any)=>x.approver_user_id)});
  if(!check.allowed)throw new Error(check.reasons.join(","));
  const{error:stepError}=await ctx.admin.from("internal_approval_steps").insert({approval_id:request.approval_id,approver_user_id:approver,decision:input.decision,reason:input.reason,decided_at:new Date().toISOString()});
  if(stepError)throw new Error(stepError.message);
  const{data:approval}=await ctx.admin.from("internal_approvals").select("required_approvals").eq("id",request.approval_id).single();
  // Only steps from people allowed to decide this request count, whichever route wrote them.
  const validSteps=[...(steps||[]).filter((x:any)=>x.approver_user_id!==request.requester_id&&x.approver_user_id!==identity.user_id),{approver_user_id:approver,decision:input.decision}],state=approvalState(approval.required_approvals,validSteps);
  await governanceAudit(ctx.admin,{organizationId:ctx.organizationId,actorId:approver,action:input.decision==="approved"?"request_approved":"request_denied",resourceType:"access_request",resourceId:request.id,reason:input.reason,metadata:{approved:state.approved,required:state.required}});
  if(state.status==="pending")return{request,pendingApprovals:state.required-state.approved};
  const now=new Date().toISOString();
  await ctx.admin.from("internal_approvals").update({status:state.status,resolved_at:now,resolution_reason:input.reason,updated_at:now}).eq("id",request.approval_id);
  if(state.status==="rejected"){const{data}=await ctx.admin.from("access_requests").update({status:"rejected",updated_at:now}).eq("id",request.id).select().single();return{request:data}}
  const approvers=validSteps.filter(x=>x.decision==="approved").map(x=>x.approver_user_id);
  await ctx.admin.from("access_requests").update({status:"approved",updated_at:now}).eq("id",request.id);
  if(entitlement.criticality==="critical"&&ctx.storeId){
    const action=await openGovernedAction({admin:ctx.admin,organizationId:ctx.organizationId,storeId:ctx.storeId,actorId:approver},{actionType:request.request_type==="removal"?"IDGOV_REVOKE_CRITICAL":"IDGOV_GRANT_CRITICAL",criticality:"critical",targetType:"access_request",targetIds:[request.id],payload:{request_id:request.id,approvers},preview:{title:`Conceder ${entitlement.name}`,beneficiary:identity.id,scope:request.scope_key,duration:request.requested_duration,approvers:approvers.length},idempotencyKey:`idgov:request:${request.id}`});
    await ctx.admin.from("access_requests").update({action_request_id:action.action_id}).eq("id",request.id);
    return{request:{...request,status:"approved"},confirmation:action};
  }
  return{request:await executeApprovedRequest(ctx,request,entitlement,identity,approvers)};
}

export async function executeApprovedRequest(ctx:GovernanceContext,request:any,entitlement:any,identity:any,approvers:string[]){
  const now=new Date(),fail=async(reason:string,grantId?:string)=>{const{data}=await ctx.admin.from("access_requests").update({status:"failed",failure_reason:reason,grant_id:grantId||null,updated_at:new Date().toISOString()}).eq("id",request.id).select().single();await governanceAudit(ctx.admin,{organizationId:ctx.organizationId,actorId:ctx.actorId,action:"provisioning_failed",resourceType:"access_request",resourceId:request.id,reason});return data};
  if(!identity.user_id)return fail("NO_USER_BOUND");
  await ctx.admin.from("access_requests").update({status:"provisioning",updated_at:now.toISOString()}).eq("id",request.id);
  const{data:live}=await ctx.admin.from("access_grants").select("*").eq("identity_id",identity.id).eq("entitlement_id",entitlement.id).eq("scope_key",request.scope_key).in("status",["pending","active","expiring"]).maybeSingle();
  const hours=request.requested_duration?parseFloat(String(request.requested_duration).split(" ")[0]):null,validUntil=hours?new Date(now.getTime()+hours*3600_000).toISOString():null;
  if(request.request_type==="removal"){if(!live)return fail("GRANT_NOT_FOUND");const result=await revokeGrant(ctx,{grantId:live.id,reason:request.justification});if(!result.ok)return fail(result.reason||"REVOCATION_FAILED",live.id);const{data}=await ctx.admin.from("access_requests").update({status:"completed",grant_id:live.id,updated_at:new Date().toISOString()}).eq("id",request.id).select().single();return data}
  if(request.request_type==="extension"){if(!live)return fail("GRANT_NOT_FOUND");const{validUntil:extended}=new TemporaryAccessService().extend({newValidUntil:validUntil});await ctx.admin.from("access_grants").update({valid_until:extended,status:"active",approved_by:approvers,updated_at:new Date().toISOString()}).eq("id",live.id);const{data}=await ctx.admin.from("access_requests").update({status:"completed",grant_id:live.id,updated_at:new Date().toISOString()}).eq("id",request.id).select().single();await governanceAudit(ctx.admin,{organizationId:ctx.organizationId,actorId:ctx.actorId,action:"grant_extended",resourceType:"access_grant",resourceId:live.id,metadata:{valid_until:extended}});return data}
  const{grant,result,reason}=await provisionGrant(ctx,{identity,entitlement,scope:request.scope,scopeKey:request.scope_key,sourceType:request.request_type==="jit"?"jit":"request",requestId:request.id,reason:request.justification,approvers,validUntil});
  if(!result.ok)return fail(reason||"PROVISIONING_FAILED",grant?.id);
  const{data}=await ctx.admin.from("access_requests").update({status:"completed",grant_id:grant.id,updated_at:new Date().toISOString()}).eq("id",request.id).select().single();
  return data;
}

// One path for every real grant: requests, birthright rules, JIT and break-glass all land here.
export async function provisionGrant(ctx:GovernanceContext,input:{identity:any;entitlement:any;scope:any;scopeKey:string;sourceType:string;requestId?:string|null;reason:string;approvers:string[];validUntil?:string|null}){
  const started=Date.now(),{identity,entitlement}=input,base={organization_id:ctx.organizationId,identity_id:identity.id,entitlement_id:entitlement.id,scope:input.scope,scope_key:input.scopeKey,source_type:input.sourceType,request_id:input.requestId||null,reason:input.reason,approved_by:input.approvers,valid_until:input.validUntil||null,created_by:ctx.actorId};
  const result=await new AccessProvisioningService(ctx.admin).grant({organizationId:ctx.organizationId,userId:identity.user_id,technicalRef:entitlement.technical_ref,entitlementKey:entitlement.key,scope:input.scope,scopeKey:input.scopeKey});
  if(!result.ok){
    const{data:grant}=await ctx.admin.from("access_grants").insert({...base,status:"failed",failure_reason:result.reason}).select().single();
    await emitIdentityEvent(ctx.admin,{organizationId:ctx.organizationId,kind:"revocation_failed",sourceEventId:`grant_failed:${grant?.id||crypto.randomUUID()}`,actorRef:ctx.actorId,targetType:"access_grant",targetRef:grant?.id||identity.id,severity:"high",title:"Falha ao provisionar acesso",metadata:{reason:result.reason,entitlement:entitlement.key}});
    return{grant,result,reason:result.reason};
  }
  const{data:live}=await ctx.admin.from("access_grants").select("*").eq("identity_id",identity.id).eq("entitlement_id",entitlement.id).eq("scope_key",input.scopeKey).in("status",["pending","active","expiring"]).maybeSingle();
  const payload={...base,status:"active",granted_at:new Date().toISOString(),previous_state:result.previousRole?{role:result.previousRole}:null};
  const{data:grant,error}=live?await ctx.admin.from("access_grants").update({source_type:input.sourceType,request_id:base.request_id,reason:input.reason,approved_by:input.approvers,valid_until:input.validUntil||live.valid_until,review_required:false,status:"active",updated_at:new Date().toISOString()}).eq("id",live.id).select().single():await ctx.admin.from("access_grants").insert(payload).select().single();
  if(error)return{grant:null,result:{...result,ok:false},reason:error.message};
  await governanceAudit(ctx.admin,{organizationId:ctx.organizationId,actorId:ctx.actorId,action:"access_granted",resourceType:"access_grant",resourceId:grant.id,reason:input.reason,metadata:{entitlement:entitlement.key,scope:input.scopeKey,source:input.sourceType,state:result.state,latency_ms:Date.now()-started,verified:result.verified}});
  await emitIdentityEvent(ctx.admin,{organizationId:ctx.organizationId,kind:input.sourceType==="jit"?"jit":input.sourceType==="break_glass"?"break_glass":entitlement.privileged?"elevation":"grant",sourceEventId:`granted:${grant.id}:${grant.updated_at}`,actorRef:ctx.actorId,targetType:"access_grant",targetRef:identity.identity_ref,severity:entitlement.privileged?"warning":"info",title:`Acesso concedido: ${entitlement.key}`,metadata:{source:input.sourceType,scope:input.scopeKey}});
  return{grant,result};
}

// A revocation counts only once the source confirms it. Anything else is failed, with a finding and a SOC event.
export async function revokeGrant(ctx:GovernanceContext,input:{grantId:string;reason:string;finalStatus?:"revoked"|"expired"}){
  const{data:grant}=await ctx.admin.from("access_grants").select("*,access_entitlements(*),governed_identities(*)").eq("id",input.grantId).eq("organization_id",ctx.organizationId).maybeSingle();
  if(!grant)return{ok:false,reason:"GRANT_NOT_FOUND"};
  if(!["active","expiring","failed","pending"].includes(grant.status))return{ok:true,state:"already_closed",grant};
  const entitlement=grant.access_entitlements,identity=grant.governed_identities,now=new Date().toISOString(),result=identity.user_id?await new AccessProvisioningService(ctx.admin).revoke({organizationId:ctx.organizationId,userId:identity.user_id,technicalRef:entitlement.technical_ref,entitlementKey:entitlement.key,scope:grant.scope,scopeKey:grant.scope_key,previousRole:grant.previous_state?.role||null}):{ok:false,state:"failed",reason:"NO_USER_BOUND",verified:false};
  if(!result.ok){
    await ctx.admin.from("access_grants").update({status:"failed",failure_reason:result.reason,revocation_reason:input.reason,updated_at:now}).eq("id",grant.id);
    await emitIdentityEvent(ctx.admin,{organizationId:ctx.organizationId,kind:"revocation_failed",sourceEventId:`revoke_failed:${grant.id}:${now}`,actorRef:ctx.actorId,targetType:"access_grant",targetRef:grant.id,severity:"critical",title:"Revogação não confirmada",metadata:{reason:result.reason,entitlement:entitlement.key}});
    await governanceAudit(ctx.admin,{organizationId:ctx.organizationId,actorId:ctx.actorId,action:"revocation_failed",resourceType:"access_grant",resourceId:grant.id,reason:result.reason});
    return{ok:false,reason:result.reason,grant};
  }
  const{data:updated,error}=await ctx.admin.from("access_grants").update({status:input.finalStatus||"revoked",revocation_reason:input.reason,revoked_at:now,revocation_confirmed_at:now,failure_reason:null,updated_at:now}).eq("id",grant.id).select().single();
  if(error)return{ok:false,reason:error.message,grant};
  await governanceAudit(ctx.admin,{organizationId:ctx.organizationId,actorId:ctx.actorId,action:input.finalStatus==="expired"?"access_expired":"access_revoked",resourceType:"access_grant",resourceId:grant.id,reason:input.reason,metadata:{entitlement:entitlement.key,confirmed:true,state:result.state}});
  await emitIdentityEvent(ctx.admin,{organizationId:ctx.organizationId,kind:"revocation",sourceEventId:`revoked:${grant.id}:${now}`,actorRef:ctx.actorId,targetType:"access_grant",targetRef:identity.identity_ref,severity:entitlement.privileged?"warning":"info",title:`Acesso encerrado: ${entitlement.key}`,metadata:{confirmed:true,final_status:input.finalStatus||"revoked"}});
  return{ok:true,state:result.state,grant:updated};
}

const birthrightTargets=async(ctx:GovernanceContext,input:{staffRole?:string|null;storeId?:string|null})=>{const{data}=await ctx.admin.from("birthright_rules").select("match_type,match_value,entitlement_id,access_entitlements(id,key,technical_ref)").eq("organization_id",ctx.organizationId).eq("status","active");return(data||[]).filter((r:any)=>r.match_type==="organization"||(r.match_type==="staff_role"&&r.match_value===input.staffRole)||(r.match_type==="store"&&r.match_value===input.storeId)).map((r:any)=>({entitlement_id:r.entitlement_id,entitlement:r.access_entitlements,scope:r.access_entitlements?.technical_ref?.adapter==="establishment_role"&&input.storeId?{establishment_id:input.storeId}:{},scope_key:r.access_entitlements?.technical_ref?.adapter==="establishment_role"&&input.storeId?`store:${input.storeId}`:"org"}))};

export async function processJoiner(ctx:GovernanceContext,input:{identityId:string;staffRole?:string|null;storeId?:string|null;reason:string}){
  const{data:identity}=await ctx.admin.from("governed_identities").select("*").eq("id",input.identityId).eq("organization_id",ctx.organizationId).single(),targets=await birthrightTargets(ctx,input),results:any[]=[];
  for(const t of targets){const{data:entitlement}=await ctx.admin.from("access_entitlements").select("*").eq("id",t.entitlement_id).single();const{result}=await provisionGrant(ctx,{identity,entitlement,scope:t.scope,scopeKey:t.scope_key,sourceType:"birthright_role",reason:input.reason,approvers:[]});results.push({entitlement:entitlement.key,ok:result.ok,reason:result.reason})}
  return{results};
}

// A move recalculates access: what the new function does not include is revoked, so nothing accumulates silently.
export async function processMover(ctx:GovernanceContext,input:{identityId:string;staffRole?:string|null;storeId?:string|null;reason:string;apply?:boolean}){
  const{data:identity}=await ctx.admin.from("governed_identities").select("*").eq("id",input.identityId).eq("organization_id",ctx.organizationId).single(),{data:current}=await ctx.admin.from("access_grants").select("id,entitlement_id,scope_key,source_type").eq("identity_id",identity.id).in("status",["active","expiring"]),targets=await birthrightTargets(ctx,input),plan=new AccessLifecycleService().moverPlan({current:current||[],target:targets});
  if(!input.apply)return{plan,applied:false};
  const removed:any[]=[],added:any[]=[];
  for(const id of plan.remove)removed.push({id,...await revokeGrant(ctx,{grantId:id,reason:input.reason})});
  for(const t of plan.add){const full=targets.find((x:any)=>x.entitlement_id===t.entitlement_id&&x.scope_key===t.scope_key) as any,{data:entitlement}=await ctx.admin.from("access_entitlements").select("*").eq("id",t.entitlement_id).single(),{result}=await provisionGrant(ctx,{identity,entitlement,scope:full.scope,scopeKey:full.scope_key,sourceType:"lifecycle_rule",reason:input.reason,approvers:[]});added.push({entitlement:entitlement.key,ok:result.ok})}
  await governanceAudit(ctx.admin,{organizationId:ctx.organizationId,actorId:ctx.actorId,action:"mover_processed",resourceType:"governed_identity",resourceId:identity.id,reason:input.reason,metadata:{removed:removed.length,added:added.length}});
  return{plan,applied:true,removed,added};
}

// Priority path. Every step is read back; the event is confirmed only when all of them hold.
export async function processLeaver(ctx:GovernanceContext,input:{eventId?:string;userId:string;reason:string}){
  const service=new AccessLifecycleService(),org=ctx.organizationId,started=Date.now();
  await syncIdentities(ctx.admin,org);
  const{data:identity}=await ctx.admin.from("governed_identities").select("*").eq("organization_id",org).eq("user_id",input.userId).maybeSingle();
  const{data:event}=input.eventId?{data:{id:input.eventId}}:await ctx.admin.from("identity_lifecycle_events").upsert({organization_id:org,user_id:input.userId,identity_id:identity?.id||null,event_type:"leaver",source_system:"identity_governance",source_ref:`${input.userId}:${new Date().toISOString().slice(0,10)}`,priority:100,status:"processing",requested_by:ctx.actorId},{onConflict:"organization_id,event_type,source_system,source_ref"}).select("id").single();
  await ctx.admin.from("identity_lifecycle_events").update({status:"processing",identity_id:identity?.id||null}).eq("id",event.id);
  if(identity)await ctx.admin.from("governed_identities").update({lifecycle_status:"leaving",updated_at:new Date().toISOString()}).eq("id",identity.id);
  let failedGrants=0,revoked=0;
  if(identity){const{data:grants}=await ctx.admin.from("access_grants").select("id").eq("identity_id",identity.id).in("status",["active","expiring","failed","pending"]);for(const g of grants||[]){const r=await revokeGrant(ctx,{grantId:g.id,reason:input.reason});if(r.ok)revoked++;else failedGrants++}}
  // Access nobody governed yet leaves too: reads what is effective now and removes it through the same facade.
  const provisioning=new AccessProvisioningService(ctx.admin),{data:catalog}=await ctx.admin.from("access_entitlements").select("key,technical_ref").eq("organization_id",org),refs=new Map((catalog||[]).map((x:any)=>[x.key,x.technical_ref]));
  for(const e of await readEffectiveAccess(ctx.admin,org,input.userId)){const technicalRef:any=refs.get(e.entitlementKey);if(!technicalRef)continue;const r=await provisioning.revoke({organizationId:org,userId:input.userId,technicalRef,entitlementKey:e.entitlementKey,scope:e.scope,scopeKey:e.scopeKey});if(!r.ok)failedGrants++}
  const records=await ctx.admin.rpc("rbac_offboard_employee_records",{requested_organization_id:org,requested_user_id:input.userId});
  const stillEffective=(await readEffectiveAccess(ctx.admin,org,input.userId)).length;
  const[{data:profile},{count:otherOrgs},{count:otherStores}]=await Promise.all([ctx.admin.from("profiles").select("is_superadmin").eq("id",input.userId).maybeSingle(),ctx.admin.from("organization_members").select("organization_id",{count:"exact",head:true}).eq("user_id",input.userId).eq("active",true).neq("organization_id",org),ctx.admin.from("establishment_members").select("id",{count:"exact",head:true}).eq("user_id",input.userId)]);
  const disable=service.disableAccount({otherOrganizationMemberships:(otherOrgs||0)+(otherStores||0),isSuperadmin:Boolean(profile?.is_superadmin)});
  const sessions=await ctx.admin.rpc("rbac_revoke_user_sessions",{requested_organization_id:org,requested_user_id:input.userId,requested_reason:"identity_leaver",requested_include_global:disable});
  let accountDisabled:boolean|null=null;
  if(disable){const{error}=await ctx.admin.auth.admin.updateUserById(input.userId,{ban_duration:"876000h"});accountDisabled=!error;if(!error){const{data:check}=await ctx.admin.auth.admin.getUserById(input.userId);accountDisabled=Boolean(check?.user?.banned_until&&Date.parse(check.user.banned_until)>Date.now())}}
  const outcome=service.leaverOutcome({grantsFailed:failedGrants,grantsStillEffective:stillEffective,recordsRemaining:Number(records.data?.remaining_active??(records.error?1:0)),sessionsRemaining:Number(sessions.data?.remaining??(sessions.error?1:0)),accountDisabled}),now=new Date().toISOString(),seconds=(Date.now()-started)/1000;
  await ctx.admin.from("identity_lifecycle_events").update({status:outcome.status,failure_reason:outcome.failures.join(",")||null,results:{revoked,failedGrants,stillEffective,sessions:sessions.data,accountDisabled,accountShared:!disable,seconds},completed_at:now}).eq("id",event.id);
  if(identity)await ctx.admin.from("governed_identities").update({lifecycle_status:outcome.status==="confirmed"?"terminated":"leaving",updated_at:now}).eq("id",identity.id);
  await governanceAudit(ctx.admin,{organizationId:org,actorId:ctx.actorId,action:outcome.status==="confirmed"?"leaver_confirmed":"leaver_failed",resourceType:"identity_lifecycle_event",resourceId:event.id,reason:input.reason,metadata:{revoked,failures:outcome.failures,account_disabled:accountDisabled}});
  await emitIdentityEvent(ctx.admin,{organizationId:org,kind:outcome.status==="confirmed"?"leaver":"revocation_failed",sourceEventId:`leaver:${event.id}:${outcome.status}`,actorRef:ctx.actorId,targetType:"governed_identity",targetRef:input.userId,severity:outcome.status==="confirmed"?"warning":"critical",title:outcome.status==="confirmed"?"Desligamento com revogação confirmada":"Desligamento com revogação incompleta",metadata:{failures:outcome.failures}});
  return{eventId:event.id,...outcome,revoked,accountDisabled};
}
