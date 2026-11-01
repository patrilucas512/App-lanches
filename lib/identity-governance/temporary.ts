/* eslint-disable @typescript-eslint/no-explicit-any */
/* JIT, privileged sessions and the deterministic expiration sweep. Safe to re-run: closed rows are skipped. */
import {scopeKeyOf} from "./core.ts";
import {provisionGrant,revokeGrant,type GovernanceContext} from "./requests.ts";
import {JitAccessService,TemporaryAccessService,hoursOfInterval} from "./rules.ts";
import {governanceAudit} from "./server.ts";

const settingsOf=async(ctx:GovernanceContext)=>(await ctx.admin.from("identity_governance_settings").select("*").eq("organization_id",ctx.organizationId).maybeSingle()).data||{require_mfa_for_privileged:true,expiry_warning_hours:24,break_glass_max_minutes:60,break_glass_review_hours:72,break_glass_requires_incident:true,jit_max_minutes:240,dormant_days:90,review_due_days:30,pre_approved_jit_keys:[]};
export {settingsOf};

export async function requestJit(ctx:GovernanceContext,input:{identityId:string;entitlementId:string;minutes:number;justification:string;scope?:{establishment_id?:string};changeRef?:string|null;incidentRef?:string|null}){
  const service=new JitAccessService(),settings=await settingsOf(ctx),[{data:identity},{data:entitlement}]=await Promise.all([ctx.admin.from("governed_identities").select("*").eq("id",input.identityId).eq("organization_id",ctx.organizationId).maybeSingle(),ctx.admin.from("access_entitlements").select("*").eq("id",input.entitlementId).eq("organization_id",ctx.organizationId).maybeSingle()]);
  if(!identity||!entitlement)throw new Error("IDENTITY_OR_ENTITLEMENT_NOT_IN_TENANT");
  if(entitlement.technical_ref?.adapter==="read_only")throw new Error("NO_OFFICIAL_PATH");
  const validation=service.validate({minutes:input.minutes,maxMinutes:settings.jit_max_minutes,entitlementMaxHours:hoursOfInterval(entitlement.max_duration),justification:input.justification});
  if(!validation.valid)throw new Error(validation.issues.join(","));
  const preApproved=service.preApproved({key:entitlement.key,preApprovedKeys:settings.pre_approved_jit_keys||[],criticality:entitlement.criticality}),scope=input.scope||{};
  const{data,error}=await ctx.admin.from("jit_sessions").insert({organization_id:ctx.organizationId,identity_id:identity.id,entitlement_id:entitlement.id,status:preApproved?"approved":"requested",scope,scope_key:scopeKeyOf(scope),justification:input.justification,requested_minutes:input.minutes,pre_approved:preApproved,linked_change_ref:input.changeRef||null,linked_incident_ref:input.incidentRef||null}).select().single();
  if(error)throw new Error(error.message);
  await governanceAudit(ctx.admin,{organizationId:ctx.organizationId,actorId:ctx.actorId,action:"jit_requested",resourceType:"jit_session",resourceId:data.id,reason:input.justification,metadata:{entitlement:entitlement.key,minutes:input.minutes,pre_approved:preApproved}});
  return data;
}

export async function approveJit(ctx:GovernanceContext,input:{sessionId:string}){
  const{data:session}=await ctx.admin.from("jit_sessions").select("*,governed_identities(user_id)").eq("id",input.sessionId).eq("organization_id",ctx.organizationId).maybeSingle();
  if(!session)throw new Error("JIT_NOT_FOUND");
  if(session.governed_identities?.user_id===ctx.actorId)throw new Error("SELF_APPROVAL_BLOCKED");
  const status=new JitAccessService().transition(session.status,"approved"),{data}=await ctx.admin.from("jit_sessions").update({status,approved_by:[ctx.actorId],updated_at:new Date().toISOString()}).eq("id",session.id).select().single();
  await governanceAudit(ctx.admin,{organizationId:ctx.organizationId,actorId:ctx.actorId,action:"jit_approved",resourceType:"jit_session",resourceId:session.id});
  return data;
}

export async function activateJit(ctx:GovernanceContext,input:{sessionId:string}){
  const service=new JitAccessService(),settings=await settingsOf(ctx),{data:session}=await ctx.admin.from("jit_sessions").select("*,governed_identities(*),access_entitlements(*)").eq("id",input.sessionId).eq("organization_id",ctx.organizationId).maybeSingle();
  if(!session)throw new Error("JIT_NOT_FOUND");
  const identity=session.governed_identities,entitlement=session.access_entitlements;
  if(identity.user_id!==ctx.actorId)throw new Error("JIT_ONLY_BENEFICIARY_ACTIVATES");
  service.transition(session.status,"active");
  if(!service.mfaSatisfied({privileged:entitlement.privileged,requireMfa:settings.require_mfa_for_privileged,aal:ctx.aal}))throw new Error("MFA_REQUIRED");
  const now=new Date(),expiresAt=new Date(now.getTime()+session.requested_minutes*60000).toISOString(),{grant,result,reason}=await provisionGrant(ctx,{identity,entitlement,scope:session.scope,scopeKey:session.scope_key,sourceType:"jit",reason:session.justification,approvers:session.approved_by||[],validUntil:expiresAt});
  if(!result.ok){await ctx.admin.from("jit_sessions").update({status:"revoked",ended_at:now.toISOString(),grant_id:grant?.id||null}).eq("id",session.id);throw new Error(reason||"JIT_PROVISIONING_FAILED")}
  const{data}=await ctx.admin.from("jit_sessions").update({status:"active",grant_id:grant.id,activated_at:now.toISOString(),expires_at:expiresAt,updated_at:now.toISOString()}).eq("id",session.id).select().single();
  await ctx.admin.from("privileged_sessions").insert({organization_id:ctx.organizationId,grant_id:grant.id,identity_id:identity.id,origin:"jit",scope:session.scope,mfa_level:ctx.aal||null});
  return data;
}

// Ties a critical action to the privilege that allowed it. Key actions only; nothing like screen recording exists.
export async function recordPrivilegedAction(ctx:GovernanceContext,input:{grantId:string;action:string;target?:string}){
  const{data:session}=await ctx.admin.from("privileged_sessions").select("id,key_actions").eq("grant_id",input.grantId).eq("organization_id",ctx.organizationId).is("ended_at",null).maybeSingle();
  if(!session)throw new Error("PRIVILEGED_SESSION_NOT_FOUND");
  const entry={action:input.action,target:input.target||null,at:new Date().toISOString(),actor:ctx.actorId};
  await ctx.admin.from("privileged_sessions").update({key_actions:[...(session.key_actions||[]),entry]}).eq("id",session.id);
  await governanceAudit(ctx.admin,{organizationId:ctx.organizationId,actorId:ctx.actorId,action:"privileged_action",resourceType:"access_grant",resourceId:input.grantId,metadata:entry});
  return entry;
}

const closePrivileged=(admin:any,grantId:string,now:string)=>admin.from("privileged_sessions").update({ended_at:now}).eq("grant_id",grantId).is("ended_at",null);

export async function revokeJit(ctx:GovernanceContext,input:{sessionId:string;reason:string}){
  const{data:session}=await ctx.admin.from("jit_sessions").select("*").eq("id",input.sessionId).eq("organization_id",ctx.organizationId).maybeSingle();
  if(!session)throw new Error("JIT_NOT_FOUND");
  new JitAccessService().transition(session.status,"revoked");
  const now=new Date().toISOString();
  if(session.grant_id){const r=await revokeGrant(ctx,{grantId:session.grant_id,reason:input.reason});if(!r.ok)throw new Error(r.reason||"REVOCATION_FAILED");await closePrivileged(ctx.admin,session.grant_id,now)}
  const{data}=await ctx.admin.from("jit_sessions").update({status:"revoked",ended_at:now,updated_at:now}).eq("id",session.id).select().single();
  return data;
}

// Runs per organization. If the module was down, the next run catches up on everything elapsed since.
export async function sweepExpirations(ctx:GovernanceContext,now=new Date(),limit=200){
  const settings=await settingsOf(ctx),{data:grants}=await ctx.admin.from("access_grants").select("id,status,valid_until,identity_id,governed_identities(user_id),access_entitlements(name)").eq("organization_id",ctx.organizationId).in("status",["active","expiring"]).not("valid_until","is",null).order("valid_until").limit(limit),plan=new TemporaryAccessService().plan(grants||[],now,settings.expiry_warning_hours),out={expired:0,failed:0,warned:0,lagSeconds:0};
  for(const id of plan.expire){
    const grant=(grants||[]).find((x:any)=>x.id===id),r=await revokeGrant({...ctx,actorId:null},{grantId:id,reason:"Validade encerrada.",finalStatus:"expired"});
    out.lagSeconds=Math.max(out.lagSeconds,(now.getTime()-Date.parse(grant.valid_until))/1000);
    if(r.ok){out.expired++;await closePrivileged(ctx.admin,id,now.toISOString());await ctx.admin.from("jit_sessions").update({status:"expired",ended_at:now.toISOString(),updated_at:now.toISOString()}).eq("grant_id",id).eq("status","active")}else out.failed++;
  }
  for(const id of plan.warn){const grant:any=(grants||[]).find((x:any)=>x.id===id);await ctx.admin.from("access_grants").update({status:"expiring",updated_at:now.toISOString()}).eq("id",id).eq("status","active");out.warned++;if(ctx.notify&&grant?.governed_identities?.user_id)await ctx.notify(ctx.admin,{organizationId:ctx.organizationId,eventType:"access.expiring",sourceType:"access_grant",sourceId:id,title:"Acesso perto de expirar",summary:grant.access_entitlements?.name,priority:"normal",recipientUserId:grant.governed_identities.user_id,route:"/painel/seguranca/acessos?tab=Acessos Temporários / JIT"}).catch(()=>null)}
  return out;
}
