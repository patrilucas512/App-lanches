/* eslint-disable @typescript-eslint/no-explicit-any */
/* Break-glass: limited, audited and always followed by a review from someone other than the person who used it. */
import {scopeKeyOf} from "./core.ts";
import {provisionGrant,revokeGrant,type GovernanceContext} from "./requests.ts";
import {BreakGlassService} from "./rules.ts";
import {governanceAudit} from "./server.ts";
import {emitIdentityEvent} from "./soc-events.ts";
import {settingsOf} from "./temporary.ts";

export async function requestBreakGlass(ctx:GovernanceContext,input:{identityId:string;entitlementId:string;reason:string;minutes:number;incidentRef?:string|null;scope?:{establishment_id?:string}}){
  const settings=await settingsOf(ctx),[{data:identity},{data:entitlement}]=await Promise.all([ctx.admin.from("governed_identities").select("*").eq("id",input.identityId).eq("organization_id",ctx.organizationId).maybeSingle(),ctx.admin.from("access_entitlements").select("*").eq("id",input.entitlementId).eq("organization_id",ctx.organizationId).maybeSingle()]);
  if(!identity||!entitlement)throw new Error("IDENTITY_OR_ENTITLEMENT_NOT_IN_TENANT");
  if(identity.user_id!==ctx.actorId)throw new Error("BREAK_GLASS_ONLY_FOR_SELF");
  const scope=input.scope||{},scopeKey=scopeKeyOf(scope),validation=new BreakGlassService().validate({reason:input.reason,minutes:input.minutes,maxMinutes:settings.break_glass_max_minutes,requiresIncident:settings.break_glass_requires_incident,incidentRef:input.incidentRef,adapter:entitlement.technical_ref?.adapter,scopeKey});
  if(!validation.valid)throw new Error(validation.issues.join(","));
  if(input.incidentRef){const{data:incident}=await ctx.admin.from("operational_incidents").select("id").eq("id",input.incidentRef).eq("organization_id",ctx.organizationId).maybeSingle();if(!incident)throw new Error("INCIDENT_NOT_IN_TENANT")}
  const{data,error}=await ctx.admin.from("break_glass_events").insert({organization_id:ctx.organizationId,identity_id:identity.id,used_by:ctx.actorId,entitlement_id:entitlement.id,scope,scope_key:scopeKey,reason:input.reason,linked_incident_ref:input.incidentRef||null,status:"requested",requested_minutes:input.minutes}).select().single();
  if(error)throw new Error(error.message);
  await governanceAudit(ctx.admin,{organizationId:ctx.organizationId,actorId:ctx.actorId,action:"break_glass_requested",resourceType:"break_glass_event",resourceId:data.id,reason:input.reason,metadata:{entitlement:entitlement.key,minutes:input.minutes}});
  return{event:data,entitlement,identity};
}

export async function activateBreakGlass(ctx:GovernanceContext,input:{eventId:string}){
  const{data:event}=await ctx.admin.from("break_glass_events").select("*,governed_identities(*),access_entitlements(*)").eq("id",input.eventId).eq("organization_id",ctx.organizationId).maybeSingle();
  if(!event)throw new Error("BREAK_GLASS_NOT_FOUND");
  if(event.status!=="requested")throw new Error("BREAK_GLASS_NOT_REQUESTED");
  const now=new Date(),expiresAt=new Date(now.getTime()+event.requested_minutes*60000).toISOString(),settings=await settingsOf(ctx),{grant,result,reason}=await provisionGrant(ctx,{identity:event.governed_identities,entitlement:event.access_entitlements,scope:event.scope,scopeKey:event.scope_key,sourceType:"break_glass",reason:event.reason,approvers:[],validUntil:expiresAt});
  if(!result.ok)throw new Error(reason||"BREAK_GLASS_PROVISIONING_FAILED");
  const{data}=await ctx.admin.from("break_glass_events").update({status:"active",grant_id:grant.id,activated_at:now.toISOString(),expires_at:expiresAt,notified_at:now.toISOString(),review_due_at:new Date(now.getTime()+settings.break_glass_review_hours*3600_000).toISOString(),updated_at:now.toISOString()}).eq("id",event.id).select().single();
  await ctx.admin.from("privileged_sessions").insert({organization_id:ctx.organizationId,grant_id:grant.id,identity_id:event.identity_id,origin:"break_glass",scope:event.scope,mfa_level:ctx.aal||null});
  await emitIdentityEvent(ctx.admin,{organizationId:ctx.organizationId,kind:"break_glass",sourceEventId:`break_glass:${event.id}:active`,actorRef:ctx.actorId,targetType:"break_glass_event",targetRef:event.id,severity:"high",title:"Break-glass ativado",metadata:{expires_at:expiresAt,scope:event.scope_key,incident:event.linked_incident_ref}});
  if(ctx.notify){const{data:owners}=await ctx.admin.from("organization_members").select("user_id").eq("organization_id",ctx.organizationId).in("role",["owner","admin"]).eq("active",true);for(const o of owners||[])if(o.user_id!==event.used_by)await ctx.notify(ctx.admin,{organizationId:ctx.organizationId,eventType:"break_glass.activated",sourceType:"break_glass_event",sourceId:event.id,title:"Break-glass ativado",summary:event.access_entitlements?.name,priority:"critical",recipientUserId:o.user_id,requiresAction:true,route:"/painel/seguranca/acessos?tab=Break-Glass"}).catch(()=>null)}
  return data;
}

const endEvent=async(ctx:GovernanceContext,event:any,status:"closed"|"expired",reason:string)=>{const now=new Date().toISOString();if(event.grant_id){const r=await revokeGrant(ctx,{grantId:event.grant_id,reason,finalStatus:status==="expired"?"expired":"revoked"});if(!r.ok)return{ok:false,reason:r.reason};await ctx.admin.from("privileged_sessions").update({ended_at:now}).eq("grant_id",event.grant_id).is("ended_at",null)}const{data}=await ctx.admin.from("break_glass_events").update({status,closed_at:now,updated_at:now}).eq("id",event.id).select().single();return{ok:true,event:data}};

export async function closeBreakGlass(ctx:GovernanceContext,input:{eventId:string;reason:string}){const{data:event}=await ctx.admin.from("break_glass_events").select("*").eq("id",input.eventId).eq("organization_id",ctx.organizationId).maybeSingle();if(!event)throw new Error("BREAK_GLASS_NOT_FOUND");if(event.status!=="active")throw new Error("BREAK_GLASS_NOT_ACTIVE");const r=await endEvent(ctx,event,"closed",input.reason);if(!r.ok)throw new Error(r.reason||"REVOCATION_FAILED");return r.event}

export async function reviewBreakGlass(ctx:GovernanceContext,input:{eventId:string;outcome:"appropriate"|"needs_follow_up"|"out_of_scope_signal";notes:string}){
  const service=new BreakGlassService(),{data:event}=await ctx.admin.from("break_glass_events").select("*").eq("id",input.eventId).eq("organization_id",ctx.organizationId).maybeSingle();
  if(!event)throw new Error("BREAK_GLASS_NOT_FOUND");
  const check=service.canReview({reviewerId:ctx.actorId as string,usedBy:event.used_by,status:event.status});
  if(!check.allowed)throw new Error(check.reasons.join(","));
  const effect=service.reviewOutcome(input.outcome);let findingId:string|null=null;
  if(effect.finding){const{data:finding}=await ctx.admin.from("access_findings").upsert({organization_id:ctx.organizationId,finding_type:"unreviewed_break_glass",severity:"high",identity_id:event.identity_id,title:"Achado da revisão de break-glass",priority_reasons:[`revisão:${input.outcome}`],evidence:{event:event.id},fingerprint:`break_glass_review:${event.id}`},{onConflict:"organization_id,fingerprint"}).select("id").single();findingId=finding?.id||null}
  const now=new Date().toISOString(),{data,error}=await ctx.admin.from("break_glass_events").update({status:"reviewed",reviewer_id:ctx.actorId,reviewed_at:now,review_outcome:input.outcome,review_notes:input.notes,finding_id:findingId,updated_at:now}).eq("id",event.id).select().single();
  if(error)throw new Error(error.message);
  await governanceAudit(ctx.admin,{organizationId:ctx.organizationId,actorId:ctx.actorId,action:"break_glass_reviewed",resourceType:"break_glass_event",resourceId:event.id,reason:input.notes,metadata:{outcome:input.outcome}});
  if(effect.socSignal)await emitIdentityEvent(ctx.admin,{organizationId:ctx.organizationId,kind:"break_glass",sourceEventId:`break_glass:${event.id}:out_of_scope_signal`,actorRef:ctx.actorId,targetType:"break_glass_event",targetRef:event.id,severity:"high",title:"Sinal de uso fora do escopo em break-glass",metadata:{abuse_declared:false}});
  return data;
}

export async function sweepBreakGlass(ctx:GovernanceContext,now=new Date()){const{data:due}=await ctx.admin.from("break_glass_events").select("*").eq("organization_id",ctx.organizationId).eq("status","active").lte("expires_at",now.toISOString()),out={expired:0,failed:0};for(const event of due||[]){const r=await endEvent({...ctx,actorId:null},event,"expired","Janela de break-glass encerrada.");if(r.ok)out.expired++;else out.failed++}return out}
