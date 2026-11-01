/* eslint-disable @typescript-eslint/no-explicit-any */
/* Crisis links. Incidents, continuity and recall propose an announcement here; each still goes through the same approval. */
import {commsAudit,commsStoreFlags} from "./server.ts";
import {activeTemplate,deadlineFromTemplate,renderTemplate} from "./templates.ts";
import {createDraft,submitForApproval} from "./announcements.ts";

const crisisCtx=(input:{admin:any;organizationId:string;storeId?:string|null;actorId?:string|null;notify?:any})=>({...input,system:true,flags:{comms_crisis_enabled:true},permissions:[]});
export const internalCommunicationsOn=async(admin:any,storeId:string)=>{const flags=await commsStoreFlags(admin,storeId,["internal_communications_enabled","comms_crisis_enabled"]);return flags.internal_communications_enabled&&flags.comms_crisis_enabled};

const audienceOfStore=(storeId:string|null|undefined)=>storeId?{scope:{type:"store",ids:[storeId]}}:{scope:{type:"organization",ids:[]}};

export async function draftFromIncident(input:{admin:any;organizationId:string;actorId:string;storeId:string;notify?:any;incident:any;title?:string;description?:string}){
  const{incident}=input;
  // An incident in progress needs more than one announcement. Only a draft nobody has sent yet is reused.
  const{data:related}=await input.admin.from("network_announcements").select("*").eq("organization_id",input.organizationId).contains("related_refs",{incident:[incident.id]});
  const open=(related||[]).find((x:any)=>["draft","pending_approval","approved","scheduled"].includes(x.status));
  if(open)return{announcement:open,created:false};
  const template=await activeTemplate(input.admin,input.organizationId,"crise");
  const rendered=renderTemplate(template,{situacao:incident.title,detalhes:input.description||incident.summary||"Em apuração.",instrucoes:"Siga as orientações do responsável pelo incidente."});
  const{announcement,created}=await createDraft(crisisCtx(input),{type:"crisis",priority:template.priority,title:input.title||rendered.title,body:rendered.body,requiresAck:template.requires_ack,ackDeadline:deadlineFromTemplate(template),audience:audienceOfStore(incident.store_id),relatedRefs:{incident:[incident.id]},templateId:template.id,storeId:incident.store_id||input.storeId,sourceType:"incident",idempotencyKey:`incident:${incident.id}:${(related||[]).length+1}`});
  await input.admin.from("incident_relations").upsert({incident_id:incident.id,relation_type:"communication",entity_type:"internal_communication",entity_id:announcement.id,visibility:incident.visibility==="confidential"?"confidential":"operational",created_by:input.actorId},{onConflict:"incident_id,relation_type,entity_type,entity_id"});
  return{announcement,created};
}

// Called on every publication. The incident timeline shows what was said and when, from the announcement itself.
export async function linkPublishedToIncidents(ctx:any,a:any){
  const ids:string[]=a.related_refs?.incident||[];
  for(const incidentId of ids){
    const{data:incident}=await ctx.admin.from("operational_incidents").select("id,visibility").eq("id",incidentId).eq("organization_id",ctx.organizationId).maybeSingle();
    if(!incident)continue;
    await Promise.all([
      ctx.admin.from("incident_timeline_events").insert({incident_id:incident.id,event_type:"communication_sent",event_time:new Date().toISOString(),actor_user_id:ctx.actorId||null,source_type:"internal_communication",source_id:a.id,summary:`Comunicado publicado: ${a.title}`.slice(0,1000),details:{announcement_id:a.id,version:a.version,emergency:a.emergency},visibility:incident.visibility||"operational"}),
      ctx.admin.from("incident_relations").upsert({incident_id:incident.id,relation_type:"communication",entity_type:"internal_communication",entity_id:a.id,visibility:incident.visibility==="confidential"?"confidential":"operational",created_by:ctx.actorId||null},{onConflict:"incident_id,relation_type,entity_type,entity_id"}),
    ]);
  }
}

// A continuity plan may propose. It never publishes: the result is pending approval, in the approvers' inbox.
export async function proposeFromContinuity(input:{admin:any;organizationId:string;actorId:string;storeId:string;notify?:any;activation:any;plan:any}){
  const{activation,plan}=input,template=await activeTemplate(input.admin,input.organizationId,"crise"),communication=plan?.communication_plan||{};
  const rendered=renderTemplate(template,{situacao:`plano de continuidade ativado: ${plan?.name||"sem nome"}`,detalhes:String(communication.message||activation.activation_reason||"Plano ativado por decisão humana."),instrucoes:String(communication.instructions||"Siga o plano de continuidade da sua unidade.")});
  const ctx=crisisCtx(input),{announcement,created}=await createDraft(ctx,{type:"crisis",priority:template.priority,title:rendered.title,body:rendered.body,requiresAck:template.requires_ack,ackDeadline:deadlineFromTemplate(template),audience:communication.audience||audienceOfStore(null),relatedRefs:{continuity_plan:[activation.plan_id],continuity_activation:[activation.id],...(activation.incident_id?{incident:[activation.incident_id]}:{})},templateId:template.id,storeId:input.storeId,sourceType:"continuity",idempotencyKey:`continuity:${activation.id}`});
  if(!created)return{announcement,proposed:false};
  const submitted=await submitForApproval(ctx,{id:announcement.id,confirmSensitive:true});
  return{announcement:submitted.announcement,proposed:true};
}

export async function draftFromRecall(input:{admin:any;organizationId:string;actorId:string;storeId:string;notify?:any;recall:any;storeIds:string[];lotLabel?:string}){
  const{recall}=input,template=await activeTemplate(input.admin,input.organizationId,"recall_alimentar"),rendered=renderTemplate(template,{item:recall.title,lote:input.lotLabel||"informado na tela de Qualidade"});
  const audience=input.storeIds.length?{scope:{type:"store",ids:input.storeIds}}:{scope:{type:"organization",ids:[]}};
  const{announcement,created}=await createDraft(crisisCtx(input),{type:"recall_food_safety",priority:template.priority,title:rendered.title,body:rendered.body,requiresAck:true,ackDeadline:deadlineFromTemplate(template),audience,relatedRefs:{recall:[recall.id]},templateId:template.id,storeId:input.storeId,sourceType:"recall",idempotencyKey:`recall:${recall.id}`});
  if(created)await commsAudit(input.admin,{organizationId:input.organizationId,storeId:input.storeId,actorId:input.actorId,action:"recall_draft_created",resourceType:"network_announcement",resourceId:announcement.id,metadata:{recall_id:recall.id}});
  return{announcement,created};
}

const AUTOMATION_DRAFT_ACTIONS:Record<string,{ref:string;type:string}>={
  opening_create_communication_draft:{ref:"store_opening",type:"store_opening"},
  audit_create_communication_draft:{ref:"audit",type:"procedure_change"},
  knowledge_create_communication_draft:{ref:"sop",type:"procedure_change"},
  comms_create_draft:{ref:"",type:"general"},
};
export const isCommunicationDraftAction=(action:string)=>action in AUTOMATION_DRAFT_ACTIONS;

// The automation worker and the copilots get a draft and nothing more: there is no publish path from here.
export async function draftFromAutomation(input:{admin:any;organizationId:string;storeId?:string|null;ownerUserId?:string|null;actionType:string;executionId:string;nodeId:string;inputs?:any}){
  const spec=AUTOMATION_DRAFT_ACTIONS[input.actionType];
  if(!spec)throw new Error("ACTION_NOT_REGISTERED");
  const inputs=input.inputs||{},sourceId=inputs.source_id?String(inputs.source_id):null;
  const{announcement}=await createDraft(crisisCtx({admin:input.admin,organizationId:input.organizationId,storeId:input.storeId,actorId:input.ownerUserId}),{type:inputs.type||spec.type,priority:inputs.priority||"info",title:String(inputs.title||"Rascunho de comunicado"),body:String(inputs.body||"Revise e complete este rascunho antes de publicar."),audience:inputs.audience||audienceOfStore(input.storeId),relatedRefs:spec.ref&&sourceId?{[spec.ref]:[sourceId]}:{},storeId:input.storeId,sourceType:"automation",idempotencyKey:`automation:${input.executionId}:${input.nodeId}`});
  return announcement;
}
