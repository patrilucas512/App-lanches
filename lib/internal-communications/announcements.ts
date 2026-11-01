/* eslint-disable @typescript-eslint/no-explicit-any */
/* Life of an announcement. Every publish path, including the scheduler, goes through publishAnnouncement, so no path skips the approval gate. */
import {AudienceResolver,loadAudienceUniverse,normalizeAudience} from "./audiences.ts";
import {COMMS_PRIORITIES,COMMS_TYPES,CRISIS_TYPES,approvalRequirement,canDecideApproval,canTransition,checkContent,contentHash,emergencyGate,isMaterialChange,mustData,publishPermissions,sanitizeRefs} from "./core.ts";
import {commsAudit,commsSettings,emitCommsEvent} from "./server.ts";
import {enqueueDelivery} from "./delivery.ts";
import {linkPublishedToIncidents} from "./crisis.ts";

const need=(ctx:any,permission:string)=>{if(!ctx.system&&!ctx.permissions?.includes(permission))throw new Error("FORBIDDEN")};
const nowIso=()=>new Date().toISOString();
export const scopeIdOf=(definition:any)=>definition.scope.ids.length===1&&definition.scope.type!=="team"?definition.scope.ids[0]:null;

// Someone with some of the stores cannot address the ones they do not have.
function assertTargets(ctx:any,targets:string[]){
  if(ctx.system||ctx.allStores)return;
  if(targets.some(id=>!ctx.storeIds?.includes(id)))throw new Error("FORBIDDEN");
}

export async function loadAnnouncement(ctx:any,id:string){
  const{data}=await ctx.admin.from("network_announcements").select("*").eq("id",id).eq("organization_id",ctx.organizationId).maybeSingle();
  if(!data)throw new Error("ANNOUNCEMENT_NOT_FOUND");
  return data;
}

async function targetsOf(ctx:any,definition:any){
  const universe=await loadAudienceUniverse(ctx.admin,ctx.organizationId,definition),resolver=new AudienceResolver();
  return{universe,stores:resolver.targetStores(definition,universe),recipients:resolver.resolve(definition,universe)};
}

export async function previewAudience(ctx:any,value:any){
  const definition=normalizeAudience(value),{stores,recipients}=await targetsOf(ctx,definition);
  assertTargets(ctx,stores);
  const byStore:Record<string,number>={};for(const r of recipients)if(r.storeId)byStore[r.storeId]=(byStore[r.storeId]||0)+1;
  return{stores:stores.length,recipients:recipients.length,byStore};
}

export async function createDraft(ctx:any,input:any){
  need(ctx,"comms:create");
  const type=input.type||"general",priority=input.priority||"info",title=String(input.title||"").trim(),body=String(input.body||"").trim();
  if(!(COMMS_TYPES as readonly string[]).includes(type))throw new Error("TYPE_INVALID");
  if(!(COMMS_PRIORITIES as readonly string[]).includes(priority))throw new Error("PRIORITY_INVALID");
  if(title.length<3||title.length>180)throw new Error("TITLE_REQUIRED");
  if(body.length<3||body.length>10000)throw new Error("BODY_REQUIRED");
  if(CRISIS_TYPES.includes(type)&&!ctx.system&&!ctx.flags?.comms_crisis_enabled)throw new Error("FEATURE_DISABLED");
  if(input.aiGenerated&&!ctx.system&&!ctx.flags?.comms_ai_drafts_enabled)throw new Error("FEATURE_DISABLED");
  const definition=normalizeAudience(input.audience),{stores}=await targetsOf(ctx,definition);
  assertTargets(ctx,stores);
  if(input.idempotencyKey){const{data:existing}=await ctx.admin.from("network_announcements").select("*").eq("organization_id",ctx.organizationId).eq("idempotency_key",input.idempotencyKey).maybeSingle();if(existing)return{announcement:existing,created:false}}
  const requiresAck=Boolean(input.requiresAck)||priority==="mandatory",data=mustData(await ctx.admin.from("network_announcements").insert({
    organization_id:ctx.organizationId,store_id:input.storeId||ctx.storeId||null,scope_type:definition.scope.type,scope_id:scopeIdOf(definition),title,body,status:"draft",announcement_type:type,priority,audience_definition:definition,
    acknowledgement_required:requiresAck,ack_deadline:requiresAck?input.ackDeadline||null:null,publish_at:input.publishAt||null,expires_at:input.expiresAt||null,template_id:input.templateId||null,related_refs:sanitizeRefs(input.relatedRefs),
    verification:requiresAck&&input.verification?input.verification:null,ai_generated:Boolean(input.aiGenerated),source_type:input.sourceType||"manual",idempotency_key:input.idempotencyKey||null,version:1,content_hash:contentHash(title,body),created_by:ctx.actorId||null,updated_by:ctx.actorId||null,
  }).select().single(),"criar rascunho");
  await commsAudit(ctx.admin,{organizationId:ctx.organizationId,storeId:data.store_id,actorId:ctx.actorId,action:"draft_created",resourceType:"network_announcement",resourceId:data.id,metadata:{type,priority,source:data.source_type,ai_generated:data.ai_generated}});
  return{announcement:data,created:true};
}

async function gateFor(ctx:any,a:any){
  const definition=normalizeAudience(a.audience_definition),{stores,recipients}=await targetsOf(ctx,definition);
  let policyRequires=false;
  if(ctx.policyDecide)try{const decision=await ctx.policyDecide({organizationId:ctx.organizationId,policyKey:"comms.publish",context:{type:a.announcement_type,priority:a.priority,scope_type:a.scope_type,target_stores:stores.length,ai_generated:a.ai_generated}});policyRequires=["require_approval","deny"].includes(decision?.decision?.decision||decision?.decision)}catch{policyRequires=false}
  return{definition,stores,recipients,requirement:approvalRequirement({type:a.announcement_type,scopeType:a.scope_type,targetStores:stores.length,aiGenerated:a.ai_generated,policyRequires})};
}

function assertContent(a:{title:string;body:string},confirmSensitive?:boolean){
  const check=checkContent(`${a.title}\n${a.body}`);
  if(!check.ok)throw new Error(`SENSITIVE_DATA_BLOCKED:${check.blocked.join(",")}`);
  if(check.warnings.length&&!confirmSensitive)throw new Error(`SENSITIVE_DATA_CONFIRM:${check.warnings.join(",")}`);
}

async function approvers(ctx:any,storeId?:string|null){
  const[{data:org},{data:extra}]=await Promise.all([ctx.admin.from("organization_members").select("user_id").eq("organization_id",ctx.organizationId).eq("active",true).in("role",["owner","admin"]),ctx.admin.from("comms_member_permissions").select("user_id").eq("organization_id",ctx.organizationId).eq("permission_key","comms:approve").eq("active",true)]);
  const{data:owners}=storeId?await ctx.admin.from("establishment_members").select("user_id").eq("establishment_id",storeId).eq("role","owner").eq("status","active"):{data:[]};
  return[...new Set([...(org||[]),...(extra||[]),...(owners||[])].map((x:any)=>x.user_id))] as string[];
}

async function openApproval(ctx:any,a:any,reasons:string[],title:string){
  const settings=await commsSettings(ctx.admin,ctx.organizationId),approval=mustData(await ctx.admin.from("internal_approvals").insert({approval_type:"internal_communication",title,description:`Motivos: ${reasons.join(", ")}`,source_type:"network_announcement",source_id:a.id,status:"pending",required_approvals:settings.required_approvals,risk_level:CRISIS_TYPES.includes(a.announcement_type)?"critical":"high",requested_by:ctx.actorId||null}).select().single(),"abrir aprovação");
  if(ctx.notify)for(const userId of await approvers(ctx,a.store_id))if(userId!==ctx.actorId||settings.self_approval_allowed)await ctx.notify(ctx.admin,{organizationId:ctx.organizationId,storeId:a.store_id,eventType:"comms.approval_requested",sourceType:"network_announcement",sourceId:a.id,title:`Aprovar comunicado: ${a.title}`.slice(0,180),summary:"Um comunicado está aguardando sua decisão.",priority:CRISIS_TYPES.includes(a.announcement_type)?"critical":"high",recipientUserId:userId,requiresAction:true,route:`/painel/operacoes/comunicacao-interna?tab=Comunicados&id=${a.id}`,allowedActions:["open"]});
  return approval;
}

export async function submitForApproval(ctx:any,input:{id:string;confirmSensitive?:boolean}){
  need(ctx,"comms:create");
  const a=await loadAnnouncement(ctx,input.id);
  if(!canTransition(a.status,"pending_approval"))throw new Error("STATUS_INVALID");
  assertContent(a,input.confirmSensitive);
  const{stores,requirement}=await gateFor(ctx,a);
  assertTargets(ctx,stores);
  if(!requirement.required)return{announcement:a,required:false,reasons:[]};
  const approval=await openApproval(ctx,a,requirement.reasons,`Comunicado: ${a.title}`.slice(0,180));
  const data=mustData(await ctx.admin.from("network_announcements").update({status:"pending_approval",approval_id:approval.id,approved_hash:null,updated_by:ctx.actorId||null,updated_at:nowIso()}).eq("id",a.id).eq("status",a.status).select().single(),"enviar para aprovação");
  await commsAudit(ctx.admin,{organizationId:ctx.organizationId,storeId:a.store_id,actorId:ctx.actorId,action:"approval_requested",resourceType:"network_announcement",resourceId:a.id,metadata:{reasons:requirement.reasons,approval_id:approval.id}});
  return{announcement:data,required:true,reasons:requirement.reasons};
}

export async function decideApproval(ctx:any,input:{id:string;decision:"approved"|"rejected";reason:string}){
  need(ctx,"comms:approve");
  if(String(input.reason||"").trim().length<3)throw new Error("REASON_REQUIRED");
  const a=await loadAnnouncement(ctx,input.id),approvalId=a.status==="pending_approval"?a.approval_id:a.pending_edit_approval_id;
  if(!approvalId)throw new Error("NO_PENDING_APPROVAL");
  const{stores}=await targetsOf(ctx,normalizeAudience(a.audience_definition));
  assertTargets(ctx,stores);
  const[settings,{data:approval},{data:steps}]=await Promise.all([commsSettings(ctx.admin,ctx.organizationId),ctx.admin.from("internal_approvals").select("*").eq("id",approvalId).single(),ctx.admin.from("internal_approval_steps").select("approver_user_id,decision").eq("approval_id",approvalId)]);
  const check=canDecideApproval({approverId:ctx.actorId,authorId:a.created_by,requesterId:approval.requested_by,alreadyDecided:(steps||[]).map((x:any)=>x.approver_user_id),selfApprovalAllowed:settings.self_approval_allowed});
  if(!check.allowed)throw new Error(String(check.reason));
  mustData(await ctx.admin.from("internal_approval_steps").insert({approval_id:approvalId,approver_user_id:ctx.actorId,decision:input.decision,reason:input.reason,decided_at:nowIso()}).select().single(),"registrar decisão");
  const all=[...(steps||[]),{decision:input.decision}],approved=all.filter((x:any)=>x.decision==="approved").length,rejected=all.some((x:any)=>x.decision==="rejected"),status=rejected?"rejected":approved>=approval.required_approvals?"approved":"pending";
  await commsAudit(ctx.admin,{organizationId:ctx.organizationId,storeId:a.store_id,actorId:ctx.actorId,action:input.decision==="approved"?"approval_granted":"approval_rejected",resourceType:"network_announcement",resourceId:a.id,reason:input.reason,metadata:{approved,required:approval.required_approvals,edit:Boolean(a.pending_edit_approval_id)}});
  if(status==="pending")return{announcement:a,pendingApprovals:approval.required_approvals-approved};
  const now=nowIso();
  await ctx.admin.from("internal_approvals").update({status,resolved_at:now,resolution_reason:input.reason,updated_at:now}).eq("id",approvalId);
  if(a.pending_edit_approval_id===approvalId){
    if(status==="rejected")return{announcement:mustData(await ctx.admin.from("network_announcements").update({pending_edit:null,pending_edit_approval_id:null,updated_at:now}).eq("id",a.id).select().single(),"recusar edição")};
    return applyVersion(ctx,a,a.pending_edit);
  }
  const hasSchedule=status==="approved"&&a.publish_at&&Date.parse(a.publish_at)>Date.now();
  const patch:any=status==="approved"?{status:hasSchedule?"scheduled":"approved",approved_hash:contentHash(a.title,a.body),updated_at:now}:{status:"draft",approval_id:null,approved_hash:null,updated_at:now};
  return{announcement:mustData(await ctx.admin.from("network_announcements").update(patch).eq("id",a.id).eq("status","pending_approval").select().single(),"concluir aprovação")};
}

// A real decision in Phase 32 over this exact text. Editing the text afterwards is what approved_hash catches.
async function hasValidApproval(ctx:any,a:any){
  if(!a.approval_id||a.approved_hash!==contentHash(a.title,a.body))return false;
  const{data}=await ctx.admin.from("internal_approvals").select("status,source_id").eq("id",a.approval_id).maybeSingle();
  return data?.status==="approved"&&data?.source_id===a.id;
}

export async function scheduleAnnouncement(ctx:any,input:{id:string;publishAt:string;confirmSensitive?:boolean}){
  need(ctx,"comms:create");
  const a=await loadAnnouncement(ctx,input.id),when=Date.parse(input.publishAt);
  if(!Number.isFinite(when)||when<=Date.now())throw new Error("PUBLISH_AT_INVALID");
  if(!canTransition(a.status,"scheduled"))throw new Error("STATUS_INVALID");
  assertContent(a,input.confirmSensitive);
  const{stores,requirement}=await gateFor(ctx,a);
  assertTargets(ctx,stores);
  for(const p of publishPermissions({type:a.announcement_type,scopeType:a.scope_type}))need(ctx,p);
  if(requirement.required&&!(await hasValidApproval(ctx,a)))throw new Error("APPROVAL_REQUIRED");
  const data=mustData(await ctx.admin.from("network_announcements").update({status:"scheduled",publish_at:new Date(when).toISOString(),updated_by:ctx.actorId||null,updated_at:nowIso()}).eq("id",a.id).eq("status",a.status).select().single(),"agendar");
  await commsAudit(ctx.admin,{organizationId:ctx.organizationId,storeId:a.store_id,actorId:ctx.actorId,action:"scheduled",resourceType:"network_announcement",resourceId:a.id,metadata:{publish_at:data.publish_at}});
  return{announcement:data};
}

export async function publishAnnouncement(ctx:any,input:{id:string;confirmSensitive?:boolean;emergency?:boolean;reason?:string}){
  const a=await loadAnnouncement(ctx,input.id);
  if(!canTransition(a.status,"published"))throw new Error(a.status==="published"?"ALREADY_PUBLISHED":"STATUS_INVALID");
  if(a.expires_at&&Date.parse(a.expires_at)<=Date.now())throw new Error("ALREADY_EXPIRED");
  for(const p of publishPermissions({type:a.announcement_type,scopeType:a.scope_type}))need(ctx,p);
  if(CRISIS_TYPES.includes(a.announcement_type)&&!ctx.system&&!ctx.flags?.comms_crisis_enabled)throw new Error("FEATURE_DISABLED");
  // The scheduler already had this confirmed by a person; the hard blocks below still apply to it.
  assertContent(a,input.confirmSensitive||Boolean(ctx.system));
  const{stores,recipients,requirement}=await gateFor(ctx,a),settings=await commsSettings(ctx.admin,ctx.organizationId);
  assertTargets(ctx,stores);
  if(!recipients.length)throw new Error("AUDIENCE_EMPTY");
  let emergency=false;
  if(requirement.required&&!(await hasValidApproval(ctx,a))){
    if(!input.emergency)throw new Error("APPROVAL_REQUIRED");
    const gate=emergencyGate({allowedByPolicy:settings.emergency_publish_allowed,permissions:ctx.permissions||[],type:a.announcement_type,priority:a.priority,reason:input.reason,aiGenerated:a.ai_generated});
    if(!gate.allowed)throw new Error(gate.issues.join(","));
    emergency=true;
  }
  const now=nowIso(),ackDue=a.acknowledgement_required?a.ack_deadline||null:null;
  mustData(await ctx.admin.from("network_announcement_recipients").upsert(recipients.map(r=>({announcement_id:a.id,organization_id:ctx.organizationId,user_id:r.userId,store_id:r.storeId,source:"snapshot",required_version:a.version,state:"pending",delivery_status:"pending",attempt_count:0,reminder_count:0,next_attempt_at:now,ack_due_at:ackDue})),{onConflict:"announcement_id,user_id",ignoreDuplicates:true}),"registrar público");
  const{data:claimed}=await ctx.admin.from("network_announcements").update({status:"published",published_at:now,content_hash:contentHash(a.title,a.body),emergency,emergency_reason:emergency?input.reason:null,review_due_at:emergency?new Date(Date.now()+settings.emergency_review_hours*36e5).toISOString():null,updated_by:ctx.actorId||null,updated_at:now}).eq("id",a.id).eq("status",a.status).select().maybeSingle();
  if(!claimed)throw new Error("ALREADY_PUBLISHED");
  await ctx.admin.from("network_announcement_versions").upsert({announcement_id:a.id,organization_id:ctx.organizationId,version:a.version,title:a.title,body:a.body,content_hash:contentHash(a.title,a.body),material_change:false,edited_by:ctx.actorId||null},{onConflict:"announcement_id,version",ignoreDuplicates:true});
  await commsAudit(ctx.admin,{organizationId:ctx.organizationId,storeId:a.store_id,actorId:ctx.actorId,action:emergency?"emergency_published":"published",resourceType:"network_announcement",resourceId:a.id,reason:input.reason||null,metadata:{recipients:recipients.length,stores:stores.length,approval_reasons:requirement.reasons,emergency}});
  await enqueueDelivery(ctx.admin,{organizationId:ctx.organizationId,announcementId:a.id,crisis:CRISIS_TYPES.includes(a.announcement_type)||a.priority==="urgent"});
  // Everything below is secondary. The announcement is already out, so a failure here must not make it look unpublished.
  await Promise.allSettled([
    emitCommsEvent(ctx.admin,{organizationId:ctx.organizationId,storeId:a.store_id,event:CRISIS_TYPES.includes(a.announcement_type)?"comms.crisis_published":"comms.published",aggregateType:"network_announcement",aggregateId:a.id,payload:{"announcement.id":a.id,"announcement.type":a.announcement_type,"announcement.priority":a.priority}}),
    linkPublishedToIncidents(ctx,claimed),
    indexForSearch(ctx,claimed),
  ]);
  return{announcement:claimed,recipients:recipients.length,emergency};
}

export async function completeEmergencyReview(ctx:any,input:{id:string;notes:string}){
  need(ctx,"comms:approve");
  if(String(input.notes||"").trim().length<3)throw new Error("REASON_REQUIRED");
  const a=await loadAnnouncement(ctx,input.id);
  if(!a.emergency||a.reviewed_at)throw new Error("NO_REVIEW_PENDING");
  const{data:publisher}=await ctx.admin.from("comms_audit_events").select("actor_id").eq("organization_id",ctx.organizationId).eq("resource_id",a.id).eq("action","emergency_published").maybeSingle(),settings=await commsSettings(ctx.admin,ctx.organizationId);
  if(publisher?.actor_id===ctx.actorId&&!settings.self_approval_allowed)throw new Error("SELF_APPROVAL_BLOCKED");
  const data=mustData(await ctx.admin.from("network_announcements").update({reviewed_by:ctx.actorId,reviewed_at:nowIso(),updated_at:nowIso()}).eq("id",a.id).select().single(),"revisar emergência");
  await commsAudit(ctx.admin,{organizationId:ctx.organizationId,storeId:a.store_id,actorId:ctx.actorId,action:"emergency_reviewed",resourceType:"network_announcement",resourceId:a.id,reason:input.notes});
  return{announcement:data};
}

async function applyVersion(ctx:any,a:any,edit:any){
  const material=isMaterialChange(a,edit,edit.material),next=a.version+1,now=nowIso(),hash=contentHash(edit.title,edit.body);
  const needsAgain=material&&a.acknowledgement_required,settings=needsAgain?await commsSettings(ctx.admin,ctx.organizationId):null,due=needsAgain?(a.ack_deadline&&Date.parse(a.ack_deadline)>Date.now()?a.ack_deadline:new Date(Date.now()+settings!.late_joiner_ack_hours*36e5).toISOString()):a.ack_deadline;
  mustData(await ctx.admin.from("network_announcement_versions").insert({announcement_id:a.id,organization_id:ctx.organizationId,version:next,title:edit.title,body:edit.body,content_hash:hash,material_change:material,change_note:edit.note||null,edited_by:ctx.actorId||null}).select().single(),"gravar versão");
  const data=mustData(await ctx.admin.from("network_announcements").update({title:edit.title,body:edit.body,version:next,content_hash:hash,ack_deadline:due,pending_edit:null,pending_edit_approval_id:null,approved_hash:a.approved_hash?hash:null,updated_by:ctx.actorId||null,updated_at:now}).eq("id",a.id).select().single(),"aplicar versão");
  // Old acknowledgements stay in the table with their version. They just no longer answer for the new text.
  if(needsAgain){
    await ctx.admin.from("network_announcement_recipients").update({required_version:next,state:"delivered",delivery_status:"pending",next_attempt_at:now,attempt_count:0,acknowledged_at:null,ack_due_at:due,reminder_count:0,last_reminder_at:null}).eq("announcement_id",a.id);
    await enqueueDelivery(ctx.admin,{organizationId:ctx.organizationId,announcementId:a.id,crisis:CRISIS_TYPES.includes(a.announcement_type)||a.priority==="urgent"});
  }
  await commsAudit(ctx.admin,{organizationId:ctx.organizationId,storeId:a.store_id,actorId:ctx.actorId,action:"version_edited",resourceType:"network_announcement",resourceId:a.id,reason:edit.note||null,metadata:{version:next,material,requires_new_ack:needsAgain}});
  return{announcement:data,version:next,material,requiresNewAck:Boolean(needsAgain)};
}

export async function editAnnouncement(ctx:any,input:{id:string;title?:string;body?:string;material?:boolean;note?:string;confirmSensitive?:boolean;fields?:any}){
  need(ctx,"comms:create");
  const a=await loadAnnouncement(ctx,input.id),title=String(input.title??a.title).trim(),body=String(input.body??a.body).trim();
  if(title.length<3||title.length>180)throw new Error("TITLE_REQUIRED");
  if(body.length<3||body.length>10000)throw new Error("BODY_REQUIRED");
  const{stores,requirement}=await gateFor(ctx,a);
  assertTargets(ctx,stores);
  if(["draft","approved","scheduled","pending_approval"].includes(a.status)){
    // Anything already reviewed loses that review: what was approved was the previous text.
    const fields=input.fields||{},patch:any={title,body,status:"draft",approval_id:null,approved_hash:null,content_hash:contentHash(title,body),updated_by:ctx.actorId||null,updated_at:nowIso()};
    if("priority" in fields&&(COMMS_PRIORITIES as readonly string[]).includes(fields.priority))patch.priority=fields.priority;
    if("type" in fields&&(COMMS_TYPES as readonly string[]).includes(fields.type))patch.announcement_type=fields.type;
    if("requires_ack" in fields)patch.acknowledgement_required=Boolean(fields.requires_ack);
    if("ack_deadline" in fields)patch.ack_deadline=fields.ack_deadline||null;
    if("publish_at" in fields)patch.publish_at=fields.publish_at||null;
    if("expires_at" in fields)patch.expires_at=fields.expires_at||null;
    if("related_refs" in fields)patch.related_refs=sanitizeRefs(fields.related_refs);
    if("verification" in fields)patch.verification=fields.verification||null;
    if("audience" in fields){const definition=normalizeAudience(fields.audience),next=await targetsOf(ctx,definition);assertTargets(ctx,next.stores);Object.assign(patch,{audience_definition:definition,scope_type:definition.scope.type,scope_id:scopeIdOf(definition)})}
    if(a.approval_id&&a.status==="pending_approval")await ctx.admin.from("internal_approvals").update({status:"cancelled",resolved_at:nowIso(),resolution_reason:"Comunicado alterado antes da decisão",updated_at:nowIso()}).eq("id",a.approval_id).eq("status","pending");
    const data=mustData(await ctx.admin.from("network_announcements").update(patch).eq("id",a.id).select().single(),"editar rascunho");
    await commsAudit(ctx.admin,{organizationId:ctx.organizationId,storeId:a.store_id,actorId:ctx.actorId,action:"draft_edited",resourceType:"network_announcement",resourceId:a.id,metadata:{previous_status:a.status}});
    return{announcement:data};
  }
  if(a.status!=="published")throw new Error("STATUS_INVALID");
  assertContent({title,body},input.confirmSensitive);
  for(const p of publishPermissions({type:a.announcement_type,scopeType:a.scope_type}))need(ctx,p);
  const edit={title,body,material:input.material,note:input.note||null};
  // Without this, publishing something small and editing it afterwards would walk around the approval.
  if(requirement.required){
    if(a.pending_edit_approval_id)throw new Error("EDIT_ALREADY_PENDING");
    const approval=await openApproval(ctx,a,requirement.reasons,`Edição de comunicado: ${a.title}`.slice(0,180));
    const data=mustData(await ctx.admin.from("network_announcements").update({pending_edit:edit,pending_edit_approval_id:approval.id,updated_by:ctx.actorId||null,updated_at:nowIso()}).eq("id",a.id).select().single(),"guardar edição");
    await commsAudit(ctx.admin,{organizationId:ctx.organizationId,storeId:a.store_id,actorId:ctx.actorId,action:"version_edit_requested",resourceType:"network_announcement",resourceId:a.id,metadata:{approval_id:approval.id}});
    return{announcement:data,pendingApproval:true};
  }
  return applyVersion(ctx,a,edit);
}

export async function retractAnnouncement(ctx:any,input:{id:string;reason:string;correction?:string}){
  const a=await loadAnnouncement(ctx,input.id);
  for(const p of publishPermissions({type:a.announcement_type,scopeType:a.scope_type}))need(ctx,p);
  if(String(input.reason||"").trim().length<3)throw new Error("REASON_REQUIRED");
  if(!canTransition(a.status,"retracted"))throw new Error("STATUS_INVALID");
  const{stores}=await targetsOf(ctx,normalizeAudience(a.audience_definition));
  assertTargets(ctx,stores);
  const correction=String(input.correction||"").trim()||null;
  if(correction)assertContent({title:a.title,body:correction},true);
  const now=nowIso(),data=mustData(await ctx.admin.from("network_announcements").update({status:"retracted",retracted_at:now,retracted_by:ctx.actorId||null,retraction_reason:input.reason,correction_note:correction,updated_by:ctx.actorId||null,updated_at:now}).eq("id",a.id).eq("status",a.status).select().single(),"retirar comunicado");
  await commsAudit(ctx.admin,{organizationId:ctx.organizationId,storeId:a.store_id,actorId:ctx.actorId,action:"retracted",resourceType:"network_announcement",resourceId:a.id,reason:input.reason,metadata:{has_correction:Boolean(correction)}});
  await ctx.admin.from("search_documents").update({archived:true}).eq("organization_id",ctx.organizationId).eq("entity_type","announcement").eq("entity_id",a.id);
  await ctx.admin.from("network_announcement_recipients").update({delivery_status:"pending",next_attempt_at:now,attempt_count:0}).eq("announcement_id",a.id);
  await enqueueDelivery(ctx.admin,{organizationId:ctx.organizationId,announcementId:a.id,crisis:true});
  return{announcement:data};
}

export async function archiveAnnouncement(ctx:any,input:{id:string}){
  need(ctx,"comms:create");
  const a=await loadAnnouncement(ctx,input.id);
  if(!canTransition(a.status,"archived"))throw new Error("STATUS_INVALID");
  const data=mustData(await ctx.admin.from("network_announcements").update({status:"archived",updated_by:ctx.actorId||null,updated_at:nowIso()}).eq("id",a.id).select().single(),"arquivar");
  await commsAudit(ctx.admin,{organizationId:ctx.organizationId,storeId:a.store_id,actorId:ctx.actorId,action:"archived",resourceType:"network_announcement",resourceId:a.id});
  return{announcement:data};
}

// Only people who can create announcements find them in search. Everyone else reads them in their own feed, filtered by audience.
async function indexForSearch(ctx:any,a:any){
  if(CRISIS_TYPES.includes(a.announcement_type))return;
  await ctx.admin.from("search_documents").upsert({organization_id:ctx.organizationId,store_id:a.scope_type==="store"?a.scope_id:null,entity_type:"announcement",entity_id:a.id,title:a.title,subtitle:"Comunicado interno",searchable_text:a.title,searchable_normalized:String(a.title).normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase(),keywords:["comunicado",a.announcement_type],route:`/painel/operacoes/comunicacao-interna?tab=Comunicados&id=${a.id}`,icon:"megaphone",sensitivity:"normal",required_permission:"commands:quick_create",archived:false,source_updated_at:a.updated_at},{onConflict:"organization_id,entity_type,entity_id"});
}

export async function publishDueAnnouncements(ctx:any,now=new Date()){
  const{data:due}=await ctx.admin.from("network_announcements").select("id").eq("organization_id",ctx.organizationId).eq("status","scheduled").lte("publish_at",now.toISOString()).limit(50);
  const results:Array<{id:string;ok:boolean;error?:string}>=[];
  for(const row of due||[])try{await publishAnnouncement({...ctx,system:true},{id:row.id});results.push({id:row.id,ok:true})}catch(error:any){
    // A scheduled item that cannot go out returns to a person instead of retrying forever.
    await ctx.admin.from("network_announcements").update({status:"draft",updated_at:new Date().toISOString()}).eq("id",row.id).eq("status","scheduled");
    await commsAudit(ctx.admin,{organizationId:ctx.organizationId,action:"schedule_failed",resourceType:"network_announcement",resourceId:row.id,metadata:{error:String(error.message).slice(0,200)}});
    results.push({id:row.id,ok:false,error:error.message});
  }
  return results;
}
