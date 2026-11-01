/* eslint-disable @typescript-eslint/no-explicit-any */
/* Reconciliation, findings, third parties, non-human credentials, support access and requests coming from the SOC. */
import {AccessPriorityService} from "./core.ts";
import {processLeaver,revokeGrant,type GovernanceContext} from "./requests.ts";
import {createReviewCampaign} from "./reviews.ts";
import {AccessFindingService,AccessReconciliationService,NonHumanCredentialService,SupportAccessService,ThirdPartyAccessService} from "./rules.ts";
import {governanceAudit,readEffectiveAccess,syncIdentities} from "./server.ts";
import {emitIdentityEvent} from "./soc-events.ts";
import {settingsOf} from "./temporary.ts";

export async function upsertFindings(ctx:GovernanceContext,findings:any[]){
  const now=new Date().toISOString();let opened=0;
  for(const f of findings){const{data:existing}=await ctx.admin.from("access_findings").select("id,state,accepted_until").eq("organization_id",ctx.organizationId).eq("fingerprint",f.fingerprint).maybeSingle();if(existing){const lapsed=existing.state==="accepted"&&existing.accepted_until&&Date.parse(existing.accepted_until)<=Date.now(),reopen=existing.state==="resolved"||lapsed;await ctx.admin.from("access_findings").update({last_seen_at:now,severity:f.severity,priority_reasons:f.priority_reasons,...(reopen?{state:"open",resolved_at:null,accepted_reason:null,accepted_until:null,accepted_by:null}:{})}).eq("id",existing.id);if(reopen)opened++}else{await ctx.admin.from("access_findings").insert({...f,organization_id:ctx.organizationId});opened++}}
  return{opened,seen:findings.length};
}

export async function reconcileAccess(ctx:GovernanceContext){
  const{data:run,error}=await ctx.admin.from("access_reconciliation_runs").insert({organization_id:ctx.organizationId,created_by:ctx.actorId}).select("id").single();
  if(error)throw new Error(error.message);
  try{
    const[effective,{data:grants},{data:identities}]=await Promise.all([readEffectiveAccess(ctx.admin,ctx.organizationId),ctx.admin.from("access_grants").select("id,status,valid_until,scope_key,previous_state,identity_id,governed_identities(user_id),access_entitlements(key)").eq("organization_id",ctx.organizationId).in("status",["active","expiring"]),ctx.admin.from("governed_identities").select("id,user_id").eq("organization_id",ctx.organizationId)]);
    const result=new AccessReconciliationService().compare({effective,grants:(grants||[]).map((g:any)=>({id:g.id,user_id:g.governed_identities?.user_id,entitlement_key:g.access_entitlements?.key,scope_key:g.scope_key,status:g.status,valid_until:g.valid_until,previous_role:g.previous_state?.role||null}))}),byUser=new Map((identities||[]).map((i:any)=>[i.user_id,i.id])),byGrant=new Map((grants||[]).map((g:any)=>[g.id,g])),items:any[]=[];
    for(const e of result.ungoverned_access)items.push({outcome:"ungoverned_access",user_id:e.userId,identity_id:byUser.get(e.userId)||null,entitlement_key:e.entitlementKey,scope_key:e.scopeKey});
    for(const id of result.missing_access){const g:any=byGrant.get(id);items.push({outcome:"missing_access",grant_id:id,identity_id:g.identity_id,user_id:g.governed_identities?.user_id,entitlement_key:g.access_entitlements?.key,scope_key:g.scope_key})}
    for(const id of result.expired_but_active){const g:any=byGrant.get(id);items.push({outcome:"expired_but_active",grant_id:id,identity_id:g.identity_id,user_id:g.governed_identities?.user_id,entitlement_key:g.access_entitlements?.key,scope_key:g.scope_key})}
    if(items.length)await ctx.admin.from("access_drift_items").insert(items.map(x=>({...x,organization_id:ctx.organizationId,run_id:run.id})));
    const priority=new AccessPriorityService();
    await upsertFindings(ctx,items.map(x=>{const p=priority.prioritize({criticality:x.outcome==="expired_but_active"?"critical":"high",evidence:x.outcome});return{finding_type:"access_drift",severity:p.severity,identity_id:x.identity_id||null,grant_id:x.grant_id||null,title:`Drift: ${x.outcome} em ${x.entitlement_key}`,priority_reasons:p.reasons,evidence:{outcome:x.outcome,entitlement:x.entitlement_key,scope:x.scope_key,run:run.id},fingerprint:`access_drift:${x.outcome}:${x.user_id}:${x.entitlement_key}:${x.scope_key}`}}));
    const counts={matched:result.matched.length,ungoverned_access:result.ungoverned_access.length,missing_access:result.missing_access.length,expired_but_active:result.expired_but_active.length};
    await ctx.admin.from("access_reconciliation_runs").update({status:"completed",counts,finished_at:new Date().toISOString()}).eq("id",run.id);
    await governanceAudit(ctx.admin,{organizationId:ctx.organizationId,actorId:ctx.actorId,action:"reconciliation_completed",resourceType:"access_reconciliation_run",resourceId:run.id,metadata:counts});
    return{runId:run.id,counts,destructiveCorrection:false};
  }catch(failure:any){await ctx.admin.from("access_reconciliation_runs").update({status:"failed",error_message:failure.message,finished_at:new Date().toISOString()}).eq("id",run.id);throw failure}
}

export async function scanFindings(ctx:GovernanceContext){
  const settings=await settingsOf(ctx),[{data:identities},{data:grants},{data:profiles},{data:breakGlass},{data:sessions}]=await Promise.all([ctx.admin.from("governed_identities").select("*").eq("organization_id",ctx.organizationId),ctx.admin.from("access_grants").select("id,identity_id,status,valid_until,source_type,scope_key,entitlement_id,access_entitlements(privileged,criticality)").eq("organization_id",ctx.organizationId).in("status",["active","expiring"]),ctx.admin.from("third_party_access_profiles").select("*").eq("organization_id",ctx.organizationId),ctx.admin.from("break_glass_events").select("id,identity_id,status,review_due_at").eq("organization_id",ctx.organizationId),ctx.admin.from("security_sessions").select("user_id,last_seen_at").eq("organization_id",ctx.organizationId).order("last_seen_at",{ascending:false}).limit(2000)]),seen=new Map<string,string>();
  for(const s of sessions||[])if(!seen.has(s.user_id))seen.set(s.user_id,s.last_seen_at);
  const findings=new AccessFindingService().detect({dormantDays:settings.dormant_days,identities:(identities||[]).map((i:any)=>({...i,last_seen_at:i.last_seen_at||seen.get(i.user_id)||null})),grants:(grants||[]).map((g:any)=>({...g,privileged:g.access_entitlements?.privileged,criticality:g.access_entitlements?.criticality})),profiles:profiles||[],breakGlass:breakGlass||[]});
  return upsertFindings(ctx,findings);
}

export async function syncCredentials(ctx:GovernanceContext){
  const service=new NonHumanCredentialService(),[{data:clients},{data:identities},{data:connections},{data:agents}]=await Promise.all([ctx.admin.from("api_clients").select("id,name,status,scopes,created_by,expires_at,last_used_at").eq("organization_id",ctx.organizationId),ctx.admin.from("governed_identities").select("id,identity_ref").eq("organization_id",ctx.organizationId),ctx.admin.from("integration_connections").select("id,status,created_by").eq("organization_id",ctx.organizationId),ctx.admin.from("ai_agent_tool_permissions").select("id,agent_id,tool_id,status,granted_by,expires_at").eq("organization_id",ctx.organizationId)]),byRef=new Map((identities||[]).map((i:any)=>[i.identity_ref,i.id])),rows=[...(clients||[]).map((c:any)=>({organization_id:ctx.organizationId,identity_id:byRef.get(c.id)||null,credential_kind:"api_client",source_table:"api_clients",source_ref:c.id,scopes:c.scopes||[],owner_ref:c.created_by,expires_at:c.expires_at,last_used_at:c.last_used_at,status:c.status})),...(connections||[]).map((c:any)=>({organization_id:ctx.organizationId,credential_kind:"integration_connection",source_table:"integration_connections",source_ref:c.id,owner_ref:c.created_by||null,status:c.status})),...(agents||[]).map((a:any)=>({organization_id:ctx.organizationId,identity_id:byRef.get(a.agent_id)||null,credential_kind:"ai_tool_permission",source_table:"ai_agent_tool_permissions",source_ref:a.id,scopes:[a.tool_id],owner_ref:a.granted_by,expires_at:a.expires_at,status:a.status}))].map(x=>service.inventory(x));
  if(rows.length){const{error}=await ctx.admin.from("non_human_credentials").upsert(rows,{onConflict:"organization_id,source_table,source_ref"});if(error)throw new Error(error.message)}
  for(const r of rows.filter((x:any)=>!x.owner_ref&&x.status==="active"))await emitIdentityEvent(ctx.admin,{organizationId:ctx.organizationId,kind:"service_account",sourceEventId:`ownerless:${r.source_ref}`,targetType:String(r.source_table),targetRef:String(r.source_ref),severity:"warning",title:"Credencial de máquina sem dono"});
  return{credentials:rows.length,secretsStored:0};
}

export async function revokeCredential(ctx:GovernanceContext,input:{credentialId:string;reason:string}){
  const{data:credential}=await ctx.admin.from("non_human_credentials").select("*").eq("id",input.credentialId).eq("organization_id",ctx.organizationId).maybeSingle();
  if(!credential)throw new Error("CREDENTIAL_NOT_FOUND");
  if(credential.source_table!=="api_clients")throw new Error("NO_OFFICIAL_PATH");
  const{data,error}=await ctx.admin.rpc("rbac_revoke_api_client",{requested_organization_id:ctx.organizationId,requested_client_id:credential.source_ref,requested_actor_id:ctx.actorId});
  const confirmed=!error&&data?.status==="revoked",now=new Date().toISOString();
  await ctx.admin.from("non_human_credentials").update({status:confirmed?"revoked":credential.status,updated_at:now}).eq("id",credential.id);
  await governanceAudit(ctx.admin,{organizationId:ctx.organizationId,actorId:ctx.actorId,action:confirmed?"credential_revoked":"credential_revocation_failed",resourceType:"non_human_credential",resourceId:credential.id,reason:input.reason});
  await emitIdentityEvent(ctx.admin,{organizationId:ctx.organizationId,kind:confirmed?"service_account":"revocation_failed",sourceEventId:`credential:${credential.id}:${now}`,actorRef:ctx.actorId,targetType:"non_human_credential",targetRef:credential.source_ref,severity:confirmed?"warning":"critical",title:confirmed?"Credencial de máquina revogada":"Revogação de credencial não confirmada"});
  if(!confirmed)throw new Error(error?.message||"REVOCATION_NOT_CONFIRMED");
  return{status:"revoked"};
}

export async function upsertThirdPartyProfile(ctx:GovernanceContext,input:{vendorProfileId:string;identityId?:string|null;sponsorRef?:string;validUntil?:string;systems?:string[];scope?:Record<string,unknown>}){
  const validation=new ThirdPartyAccessService().validate({sponsorRef:input.sponsorRef,validUntil:input.validUntil});
  if(!validation.valid)throw new Error(validation.issues.join(","));
  const{data:vendor}=await ctx.admin.from("vendor_profiles").select("id").eq("id",input.vendorProfileId).eq("organization_id",ctx.organizationId).maybeSingle();
  if(!vendor)throw new Error("VENDOR_NOT_IN_TENANT");
  // A unique key never matches NULL, so a profile without identity is looked up first instead of duplicated on each save.
  const row={organization_id:ctx.organizationId,vendor_profile_id:vendor.id,identity_id:input.identityId||null,sponsor_ref:input.sponsorRef,valid_until:input.validUntil,systems:input.systems||[],scope:input.scope||{},status:"active",updated_at:new Date().toISOString()};
  let existing:any=null;if(!input.identityId)({data:existing}=await ctx.admin.from("third_party_access_profiles").select("id").eq("vendor_profile_id",vendor.id).is("identity_id",null).maybeSingle());
  const{data,error}=existing?await ctx.admin.from("third_party_access_profiles").update(row).eq("id",existing.id).select().single():await ctx.admin.from("third_party_access_profiles").upsert(row,{onConflict:"vendor_profile_id,identity_id"}).select().single();
  if(error)throw new Error(error.message);
  if(input.identityId)await ctx.admin.from("governed_identities").update({sponsor_ref:input.sponsorRef,valid_until:input.validUntil,updated_at:new Date().toISOString()}).eq("id",input.identityId).eq("organization_id",ctx.organizationId);
  await governanceAudit(ctx.admin,{organizationId:ctx.organizationId,actorId:ctx.actorId,action:"third_party_profile_saved",resourceType:"third_party_access_profile",resourceId:data.id});
  return data;
}

// The end of a relationship opens a review and marks the access; a human decides the revocations, with evidence.
export async function processVendorEnd(ctx:GovernanceContext,input:{eventId:string;vendorProfileId:string}){
  const{data:profiles}=await ctx.admin.from("third_party_access_profiles").select("*").eq("organization_id",ctx.organizationId).eq("vendor_profile_id",input.vendorProfileId),identityIds=(profiles||[]).map((p:any)=>p.identity_id).filter(Boolean),now=new Date().toISOString();
  await ctx.admin.from("third_party_access_profiles").update({status:"review_required",updated_at:now}).eq("vendor_profile_id",input.vendorProfileId).eq("organization_id",ctx.organizationId);
  const campaign=identityIds.length?await createReviewCampaign(ctx,{name:`Fim de relação com terceiro ${input.vendorProfileId.slice(0,8)}`,reviewType:"vendor_review",filters:{identityIds}}):null;
  await upsertFindings(ctx,identityIds.map((id:string)=>({finding_type:"expired_vendor_access",severity:"critical",identity_id:id,title:"Relação com terceiro encerrada; acesso em revisão",priority_reasons:["relação_encerrada"],evidence:{vendor:input.vendorProfileId},fingerprint:`expired_vendor_access:${input.vendorProfileId}:${id}`})));
  await ctx.admin.from("identity_lifecycle_events").update({status:"confirmed",results:{identities:identityIds.length,campaign:campaign?.campaign?.id||null},completed_at:now}).eq("id",input.eventId);
  await emitIdentityEvent(ctx.admin,{organizationId:ctx.organizationId,kind:"vendor_terminated",sourceEventId:`vendor_end:${input.eventId}`,targetType:"vendor_profile",targetRef:input.vendorProfileId,severity:"high",title:"Relação com terceiro encerrada",metadata:{identities:identityIds.length}});
  return{identities:identityIds.length,campaign:campaign?.campaign?.id||null};
}

export async function startImpersonation(ctx:GovernanceContext&{storeId:string},input:{caseRef:string;reason:string;minutes:number;mode?:string;approvedBy?:string|null;jitSessionId?:string|null}){
  const{data:jit}=input.jitSessionId?await ctx.admin.from("jit_sessions").select("id,status,organization_id,governed_identities(user_id)").eq("id",input.jitSessionId).eq("organization_id",ctx.organizationId).maybeSingle():{data:null as any};
  if(jit&&jit.governed_identities?.user_id!==ctx.actorId)throw new Error("JIT_NOT_OWNED_BY_ACTOR");
  if(input.approvedBy){const{data:approver}=await ctx.admin.from("profiles").select("is_superadmin").eq("id",input.approvedBy).maybeSingle();if(!approver?.is_superadmin)throw new Error("APPROVER_NOT_AUTHORIZED")}
  const validation=new SupportAccessService().impersonation({caseRef:input.caseRef,reason:input.reason,minutes:input.minutes,mode:input.mode,approvedBy:input.approvedBy,actorId:ctx.actorId as string,jitActive:jit?.status==="active"});
  if(!validation.valid)throw new Error(validation.issues.join(","));
  const{data,error}=await ctx.admin.from("impersonation_sessions").insert({superadmin_user_id:ctx.actorId,establishment_id:ctx.storeId,organization_id:ctx.organizationId,reason:input.reason,case_ref:input.caseRef,mode:validation.mode,expires_at:new Date(Date.now()+input.minutes*60000).toISOString(),approved_by:input.approvedBy||null,jit_session_id:input.jitSessionId}).select().single();
  if(error)throw new Error(error.message);
  await governanceAudit(ctx.admin,{organizationId:ctx.organizationId,actorId:ctx.actorId,action:"impersonation_started",resourceType:"impersonation_session",resourceId:data.id,reason:input.reason,metadata:{case:input.caseRef,mode:validation.mode,minutes:input.minutes}});
  return data;
}

export const SOC_REQUEST_TYPES=["revoke_session","revoke_temporary_access","disable_identity","revoke_api_token","request_access_review"] as const;
export async function listSocRequests(ctx:GovernanceContext){const{data}=await ctx.admin.from("security_response_actions").select("id,response_type,target_ref,state,reason,verification_state,requested_at,investigation_id").eq("organization_id",ctx.organizationId).in("response_type",[...SOC_REQUEST_TYPES]).in("state",["proposed","awaiting_approval","approved"]).order("requested_at",{ascending:false}).limit(100);return data||[]}

// The SOC asks; the decision and the execution stay here, and the SOC receives the verified outcome.
export async function executeSocRequest(ctx:GovernanceContext,input:{responseId:string}){
  const{data:request}=await ctx.admin.from("security_response_actions").select("*").eq("id",input.responseId).eq("organization_id",ctx.organizationId).maybeSingle();
  if(!request)throw new Error("SOC_REQUEST_NOT_FOUND");
  if(!SOC_REQUEST_TYPES.includes(request.response_type))throw new Error("SOC_REQUEST_NOT_SUPPORTED");
  if(["completed","failed","reverted"].includes(request.state))throw new Error("SOC_REQUEST_CLOSED");
  if(request.state!=="approved")throw new Error("SOC_REQUEST_NOT_APPROVED");
  const{data:claimed}=await ctx.admin.from("security_response_actions").update({state:"executing"}).eq("id",request.id).eq("state","approved").select("id").maybeSingle();
  if(!claimed)throw new Error("SOC_REQUEST_CLOSED");
  let ok=false,detail:any=null;
  try{
    if(request.response_type==="revoke_temporary_access"){const r=await revokeGrant(ctx,{grantId:request.target_ref,reason:request.reason});ok=r.ok;detail=r.reason}
    else if(request.response_type==="revoke_session"){const{data,error}=await ctx.admin.rpc("rbac_revoke_user_sessions",{requested_organization_id:ctx.organizationId,requested_user_id:request.target_ref,requested_reason:"soc_response",requested_include_global:false});ok=!error&&Number(data?.remaining)===0;detail=error?.message||data}
    else if(request.response_type==="disable_identity"){const r=await processLeaver(ctx,{userId:request.target_ref,reason:request.reason});ok=r.status==="confirmed";detail=r.failures}
    else if(request.response_type==="revoke_api_token"){const r=await revokeCredential(ctx,{credentialId:request.target_ref,reason:request.reason});ok=r.status==="revoked"}
    else{const r=await createReviewCampaign(ctx,{name:`Revisão pedida pelo SOC ${request.id.slice(0,8)}`,reviewType:"privileged_review",filters:{identityIds:[request.target_ref]}});ok=true;detail={campaign:r.campaign.id}}
  }catch(error:any){ok=false;detail=error.message}
  const{data}=await ctx.admin.from("security_response_actions").update({state:ok?"completed":"failed",verification_state:ok?"verified":"failed",verification_ref:`identity_governance:${JSON.stringify(detail??"").slice(0,200)}`,completed_at:new Date().toISOString()}).eq("id",request.id).select().single();
  await governanceAudit(ctx.admin,{organizationId:ctx.organizationId,actorId:ctx.actorId,action:ok?"soc_request_executed":"soc_request_failed",resourceType:"security_response_action",resourceId:request.id,metadata:{type:request.response_type}});
  return data;
}

export async function refreshGovernanceInventory(ctx:GovernanceContext){await syncIdentities(ctx.admin,ctx.organizationId);return syncCredentials(ctx)}
