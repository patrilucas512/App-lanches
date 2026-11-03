/* eslint-disable @typescript-eslint/no-explicit-any */
/* Residency, subprocessors, privacy incidents, impact assessments, privacy by design and AI uses. Each one reuses the module
   that owns the thing (Vendors 92, Incidents 59, Change 88, AI Governance 80) and adds only the privacy side. */
import {randomUUID} from "node:crypto";
import {DATA_CATEGORIES,dpiaRequired,mustData,privacyChecklistFor} from "./core.ts";
import {privacyAudit,privacySettings} from "./server.ts";

const categories=(list:unknown)=>(Array.isArray(list)?list:[]).map(String).filter(x=>(DATA_CATEGORIES as readonly string[]).includes(x));

// Platform rows describe MasterApp's infrastructure; the context adds its own providers. Nothing claims a guarantee by default.
export async function dataLocations(ctx:any){
  const{data,error}=await ctx.admin.from("privacy_data_locations").select("*").or(`context_id.is.null,context_id.eq.${ctx.contextId}`).order("component");
  if(error)throw new Error(error.message);return data||[];
}
export async function saveDataLocation(ctx:any,input:any){
  const row={context_id:ctx.contextId,component:String(input.component||"").slice(0,120),provider:String(input.provider||"").slice(0,120),region:input.region||null,data_categories:categories(input.data_categories),international:input.international===true,transfer_mechanism:input.transfer_mechanism||null,guarantee:["contractual","stated_by_provider","unknown"].includes(input.guarantee)?input.guarantee:"unknown",vendor_id:input.vendor_id||null,notes:input.notes||null,updated_at:new Date().toISOString()};
  if(row.component.length<3||row.provider.length<2)throw new Error("LOCATION_INVALID");
  if(row.international&&!row.transfer_mechanism)throw new Error("TRANSFER_MECHANISM_REQUIRED");
  const saved=mustData(input.id?await ctx.admin.from("privacy_data_locations").update(row).eq("id",input.id).eq("context_id",ctx.contextId).select().single():await ctx.admin.from("privacy_data_locations").insert(row).select().single(),"localização");
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:"data_location_saved",resourceType:"privacy_data_location",resourceId:saved.id,metadata:{provider:row.provider,international:row.international}});
  return saved;
}

/* Subprocessors are Phase 92 vendors with a privacy profile. A tenant sees its own vendors plus MasterApp's platform vendors,
   which is the subprocessor list MasterApp owes its tenants as their processor. */
export async function subprocessors(ctx:any){
  const[{data:vendors},{data:profiles}]=await Promise.all([
    ctx.admin.from("vendor_profiles").select("id,name,vendor_type,context_type,relationship_status,primary_region").or(`organization_id.eq.${ctx.organizationId},context_type.eq.masterapp_platform_vendors`).limit(1000),
    ctx.admin.from("vendor_privacy_profiles").select("*").or(`context_id.eq.${ctx.contextId},context_id.is.null`).limit(1000),
  ]);
  const vendorOf=new Map((vendors||[]).map((v:any)=>[v.id,v]));
  return(profiles||[]).filter((p:any)=>vendorOf.has(p.vendor_id)).map((p:any)=>({...p,vendor:vendorOf.get(p.vendor_id),reviewOverdue:Boolean(p.review_due_at&&Date.parse(p.review_due_at)<Date.now())||!p.last_reviewed_at}));
}
export async function saveSubprocessor(ctx:any,input:any){
  const{data:vendor}=await ctx.admin.from("vendor_profiles").select("id,organization_id,context_type").eq("id",input.vendor_id).maybeSingle();
  if(!vendor||(vendor.context_type==="tenant_vendors"&&vendor.organization_id!==ctx.organizationId))throw new Error("VENDOR_NOT_FOUND");
  const contextId=vendor.context_type==="masterapp_platform_vendors"?null:ctx.contextId;
  if(contextId===null&&!ctx.superadmin)throw new Error("FORBIDDEN");
  const row={vendor_id:vendor.id,context_id:contextId,data_categories:categories(input.data_categories),purpose:String(input.purpose||"").trim(),location:input.location||null,international_transfer:input.international_transfer===true,transfer_mechanism:input.transfer_mechanism||null,dpa_contract_id:input.dpa_contract_id||null,dpa_reference:input.dpa_reference||null,last_reviewed_at:input.reviewed?new Date().toISOString():input.last_reviewed_at||null,review_due_at:input.review_due_at||null,status:["active","suspended","ended"].includes(input.status)?input.status:"active",created_by:ctx.actorId,updated_at:new Date().toISOString()};
  if(row.purpose.length<5)throw new Error("PURPOSE_REQUIRED");
  if(row.international_transfer&&!row.transfer_mechanism)throw new Error("TRANSFER_MECHANISM_REQUIRED");
  const{data:existing}=await ctx.admin.from("vendor_privacy_profiles").select("id").eq("vendor_id",vendor.id)[contextId?"eq":"is"]("context_id",contextId).maybeSingle();
  const saved=mustData(existing?await ctx.admin.from("vendor_privacy_profiles").update(row).eq("id",existing.id).select().single():await ctx.admin.from("vendor_privacy_profiles").insert(row).select().single(),"suboperador");
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:"subprocessor_saved",resourceType:"vendor_privacy_profile",resourceId:saved.id,metadata:{vendor_id:vendor.id,international:row.international_transfer}});
  return saved;
}
export async function exportSubprocessors(ctx:any){
  const list=await subprocessors(ctx);
  return{generatedAt:new Date().toISOString(),subprocessors:list.filter((x:any)=>x.status==="active").map((x:any)=>({name:x.vendor?.name,type:x.vendor?.vendor_type,scope:x.context_id?"estabelecimento":"MasterApp (plataforma)",data_categories:x.data_categories,purpose:x.purpose,location:x.location||x.vendor?.primary_region||null,international_transfer:x.international_transfer,transfer_mechanism:x.transfer_mechanism,dpa:x.dpa_reference||(x.dpa_contract_id?"Contrato registrado (Fase 49)":null),last_reviewed_at:x.last_reviewed_at}))};
}

/* Privacy incidents. The incident itself lives in Phase 59 (category privacy, confidential); this records the assessment,
   the deadlines and evidence, and the human decision about telling the ANPD and the subjects. */
export async function openPrivacyIncident(ctx:any,input:{title:string;summary:string;severity?:string;source?:"manual"|"soc"|"incident";socAlertRef?:string|null;incidentId?:string|null;storeId?:string|null}){
  const settings=await privacySettings(ctx.admin,ctx.contextId);
  let incident:any;
  if(input.incidentId){incident=mustData(await ctx.admin.from("operational_incidents").select("id,organization_id,detected_at").eq("id",input.incidentId).eq("organization_id",ctx.organizationId).single(),"incidente")}
  else{
    const title=String(input.title||"").trim(),summary=String(input.summary||"").trim();if(title.length<5||summary.length<10)throw new Error("INCIDENT_INVALID");
    const severity=["SEV1","SEV2","SEV3","SEV4"].includes(String(input.severity))?input.severity:"SEV3";
    incident=mustData(await ctx.admin.from("operational_incidents").insert({organization_id:ctx.organizationId,store_id:input.storeId||null,incident_number:`PRIV-${new Date().getFullYear()}-${randomUUID().slice(0,8).toUpperCase()}`,title:title.slice(0,180),summary:summary.slice(0,2000),category:"privacy",severity,severity_reason:"Incidente de privacidade registrado em Privacidade & LGPD.",status:"detected",visibility:"confidential",source_type:input.source==="soc"?"security_operations":"privacy_operations",source_id:input.socAlertRef||null,idempotency_key:`privacy:${randomUUID()}`,owner_user_id:ctx.actorId,created_by:ctx.actorId}).select().single(),"incidente");
  }
  const detected=incident.detected_at||new Date().toISOString();
  const assessment=mustData(await ctx.admin.from("privacy_incident_assessments").insert({incident_id:incident.id,context_id:ctx.contextId,source:input.source||"manual",soc_alert_ref:input.socAlertRef||null,detected_at:detected,notification_due_at:settings.incident_notification_deadline_days?new Date(Date.parse(detected)+settings.incident_notification_deadline_days*864e5).toISOString():null,created_by:ctx.actorId}).select().single(),"avaliação");
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:"privacy_incident_opened",resourceType:"privacy_incident_assessment",resourceId:assessment.id,metadata:{incident_id:incident.id,source:input.source||"manual"}});
  return{incident,assessment};
}
export async function assessIncident(ctx:any,input:any){
  const patch:any={updated_at:new Date().toISOString()};
  if(["unknown","yes","no"].includes(input.involves_personal_data))patch.involves_personal_data=input.involves_personal_data;
  if(input.data_categories)patch.data_categories=categories(input.data_categories);
  if(input.subjects_estimate!=null){const n=Number(input.subjects_estimate);if(!(n>=0))throw new Error("ESTIMATE_INVALID");patch.subjects_estimate=Math.round(n)}
  if(["low","medium","high","critical"].includes(input.risk_level))patch.risk_level=input.risk_level;
  if(input.containment_summary!=null)patch.containment_summary=String(input.containment_summary).slice(0,2000);
  if(input.lessons_learned!=null)patch.lessons_learned=String(input.lessons_learned).slice(0,4000);
  if(input.evidence_note){const{data:current}=await ctx.admin.from("privacy_incident_assessments").select("evidence").eq("id",input.id).eq("context_id",ctx.contextId).single();patch.evidence=[...(current?.evidence||[]),{at:new Date().toISOString(),by:ctx.actorId,note:String(input.evidence_note).slice(0,500)}]}
  if(["contained","closed"].includes(input.status))patch.status=input.status;
  const saved=mustData(await ctx.admin.from("privacy_incident_assessments").update(patch).eq("id",input.id).eq("context_id",ctx.contextId).select().single(),"avaliação");
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:"privacy_incident_assessed",resourceType:"privacy_incident_assessment",resourceId:saved.id,metadata:{fields:Object.keys(patch).filter(k=>k!=="updated_at")}});
  return saved;
}
// Only a person decides. The assistant may help with drafts, never with this call.
export async function decideIncidentNotification(ctx:any,input:{id:string;anpd:"notify"|"do_not_notify";subjects:"notify"|"do_not_notify";reason:string}){
  if(ctx.actorType&&ctx.actorType!=="user")throw new Error("HUMAN_DECISION_REQUIRED");
  if(String(input.reason||"").trim().length<20)throw new Error("REASON_REQUIRED");
  const valid=["notify","do_not_notify"];if(!valid.includes(input.anpd)||!valid.includes(input.subjects))throw new Error("DECISION_INVALID");
  const now=new Date().toISOString(),saved=mustData(await ctx.admin.from("privacy_incident_assessments").update({anpd_decision:input.anpd,subjects_decision:input.subjects,decision_reason:input.reason,decided_by:ctx.actorId,decided_at:now,status:"decided",updated_at:now}).eq("id",input.id).eq("context_id",ctx.contextId).select().single(),"decisão");
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:"privacy_incident_decided",resourceType:"privacy_incident_assessment",resourceId:saved.id,reason:input.reason,metadata:{anpd:input.anpd,subjects:input.subjects}});
  return saved;
}
// Draft texts for the communications. Templates only; the legal wording is the DPO's.
export function incidentDrafts(assessment:any,store:{name?:string|null}){
  const what=(assessment.data_categories||[]).join(", ")||"a confirmar",count=assessment.subjects_estimate??"a confirmar";
  return{
    anpd:`Comunicação de incidente de segurança com dados pessoais\nControlador: ${store.name||"[estabelecimento]"}\nData da ciência: ${String(assessment.detected_at).slice(0,10)}\nCategorias de dados: ${what}\nTitulares afetados (estimativa): ${count}\nMedidas de contenção: ${assessment.containment_summary||"[descrever]"}\nRisco avaliado: ${assessment.risk_level||"[avaliar]"}\n[Rascunho para revisão do encarregado. Não enviar sem aprovação.]`,
    subjects:`Olá. Identificamos um incidente que pode ter envolvido seus dados (${what}). Já tomamos estas medidas: ${assessment.containment_summary||"[descrever]"}. Se tiver dúvidas, fale com nosso encarregado de dados. [Rascunho para revisão. Não enviar sem aprovação.]`,
  };
}
export async function markIncidentNotified(ctx:any,input:{id:string;target:"anpd"|"subjects";evidence:string}){
  if(String(input.evidence||"").trim().length<5)throw new Error("EVIDENCE_REQUIRED");
  const current=mustData(await ctx.admin.from("privacy_incident_assessments").select("*").eq("id",input.id).eq("context_id",ctx.contextId).single(),"avaliação");
  if((input.target==="anpd"?current.anpd_decision:current.subjects_decision)!=="notify")throw new Error("DECISION_REQUIRED");
  const now=new Date().toISOString(),patch:any={[input.target==="anpd"?"anpd_notified_at":"subjects_notified_at"]:now,evidence:[...(current.evidence||[]),{at:now,by:ctx.actorId,note:`Comunicação (${input.target}): ${String(input.evidence).slice(0,300)}`}],status:"notified",updated_at:now};
  const saved=mustData(await ctx.admin.from("privacy_incident_assessments").update(patch).eq("id",current.id).select().single(),"avaliação");
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:`privacy_incident_${input.target}_notified`,resourceType:"privacy_incident_assessment",resourceId:current.id});
  return saved;
}

/* RIPD/DPIA. Approval needs the DPO's opinion, recorded by someone holding privacy:dpo. */
export async function saveDpia(ctx:any,input:any){
  const settings=await privacySettings(ctx.admin,ctx.contextId);
  let triggers:string[]=Array.isArray(input.triggers)?input.triggers.map(String):[];
  if(input.activity_id){const{data:activity}=await ctx.admin.from("processing_activities").select("*").eq("id",input.activity_id).eq("context_id",ctx.contextId).maybeSingle();if(!activity)throw new Error("ACTIVITY_NOT_FOUND");triggers=[...new Set([...triggers,...dpiaRequired({...activity,shares_with_third_parties:(activity.sharing||[]).length>0},settings.dpia_triggers).reasons])]}
  const row:any={title:String(input.title||"").trim().slice(0,160),description:input.description||null,activity_id:input.activity_id||null,triggers,necessity_proportionality:input.necessity_proportionality||null,risks:Array.isArray(input.risks)?input.risks.slice(0,50):[],measures:Array.isArray(input.measures)?input.measures.slice(0,50):[],residual_risk:["low","medium","high","critical"].includes(input.residual_risk)?input.residual_risk:null,next_review_at:input.next_review_at||null,change_request_id:input.change_request_id||null,updated_at:new Date().toISOString()};
  if(row.title.length<3)throw new Error("TITLE_REQUIRED");
  let saved:any;
  if(input.id){const current=mustData(await ctx.admin.from("privacy_impact_assessments").select("*").eq("id",input.id).eq("context_id",ctx.contextId).single(),"RIPD");saved=mustData(await ctx.admin.from("privacy_impact_assessments").update({...row,version:current.version+1,status:current.status==="approved"?"needs_update":current.status,dpo_signed_at:current.status==="approved"?null:current.dpo_signed_at}).eq("id",current.id).select().single(),"RIPD")}
  else saved=mustData(await ctx.admin.from("privacy_impact_assessments").insert({...row,context_id:ctx.contextId,created_by:ctx.actorId}).select().single(),"RIPD");
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:input.id?"dpia_updated":"dpia_created",resourceType:"privacy_impact_assessment",resourceId:saved.id,metadata:{version:saved.version,triggers}});
  return saved;
}
export async function dpoOpinion(ctx:any,input:{id:string;opinion:string;decision:"approved"|"rejected"|"in_review"}){
  if(!ctx.permissions?.includes("privacy:dpo"))throw new Error("FORBIDDEN");
  if(ctx.actorType&&ctx.actorType!=="user")throw new Error("HUMAN_DECISION_REQUIRED");
  if(String(input.opinion||"").trim().length<20)throw new Error("OPINION_REQUIRED");
  const now=new Date().toISOString(),saved=mustData(await ctx.admin.from("privacy_impact_assessments").update({dpo_opinion:input.opinion,dpo_user_id:ctx.actorId,dpo_signed_at:input.decision==="approved"?now:null,status:input.decision,updated_at:now}).eq("id",input.id).eq("context_id",ctx.contextId).select().single(),"RIPD");
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:"dpia_dpo_opinion",resourceType:"privacy_impact_assessment",resourceId:saved.id,metadata:{decision:input.decision}});
  return saved;
}

/* Privacy by design on Change Management. The review writes its items into change_checklists, so the Phase 88 gates see them. */
export async function openDesignReview(ctx:any,input:{changeRequestId?:string|null;title:string;signals:any}){
  const signals={creates_personal_fields:input.signals?.creates_personal_fields===true,new_purpose:input.signals?.new_purpose===true,new_sharing:input.signals?.new_sharing===true,ai_with_personal_data:input.signals?.ai_with_personal_data===true,sensitive_data:input.signals?.sensitive_data===true};
  const checklist=privacyChecklistFor(signals);
  if(input.changeRequestId){const{data:change}=await ctx.admin.from("change_requests").select("id,organization_id").eq("id",input.changeRequestId).maybeSingle();if(!change||(change.organization_id&&change.organization_id!==ctx.organizationId))throw new Error("CHANGE_NOT_FOUND")}
  const review=mustData(await ctx.admin.from("privacy_design_reviews").insert({context_id:ctx.contextId,change_request_id:input.changeRequestId||null,title:String(input.title||"Revisão de privacidade").slice(0,160),signals,checklist:checklist.items,dpia_suggested:checklist.dpiaSuggested,status:checklist.required?"open":"passed",created_by:ctx.actorId}).select().single(),"revisão");
  if(input.changeRequestId&&checklist.items.length)await ctx.admin.from("change_checklists").upsert(checklist.items.map(item=>({organization_id:ctx.organizationId,change_id:input.changeRequestId,item_key:`privacy:${item}`,item_type:"privacy",required:true,status:"pending",evidence_source:"privacy_operations"})),{onConflict:"change_id,item_key",ignoreDuplicates:true});
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:"design_review_opened",resourceType:"privacy_design_review",resourceId:review.id,metadata:{change_request_id:input.changeRequestId||null,items:checklist.items}});
  return{review,checklist};
}
export async function decideDesignReview(ctx:any,input:{id:string;status:"passed"|"waived"|"failed";reason:string}){
  if(!["passed","waived","failed"].includes(input.status))throw new Error("STATUS_INVALID");
  if(String(input.reason||"").trim().length<10)throw new Error("REASON_REQUIRED");
  const review=mustData(await ctx.admin.from("privacy_design_reviews").update({status:input.status,decided_by:ctx.actorId,decision_reason:input.reason,updated_at:new Date().toISOString()}).eq("id",input.id).eq("context_id",ctx.contextId).select().single(),"revisão");
  if(review.change_request_id)await ctx.admin.from("change_checklists").update({status:input.status==="passed"?"passed":input.status==="waived"?"waived":"failed",waiver_reason:input.status==="waived"?input.reason:null,evidence_ref:`privacy_design_review:${review.id}`,completed_by:ctx.actorId,completed_at:new Date().toISOString()}).eq("change_id",review.change_request_id).like("item_key","privacy:%");
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:"design_review_decided",resourceType:"privacy_design_review",resourceId:review.id,reason:input.reason,metadata:{status:input.status}});
  return review;
}

// AI Governance: which agents and models touch personal data, for which purpose, under which consent.
export async function saveAiUse(ctx:any,input:any){
  const row={context_id:ctx.contextId,ai_agent_id:input.ai_agent_id||null,ai_model_profile_id:input.ai_model_profile_id||null,purpose:String(input.purpose||"").trim(),data_categories:categories(input.data_categories),activity_id:input.activity_id||null,consent_purpose_key:input.consent_purpose_key||null,automated_decision:input.automated_decision===true,status:["active","paused","retired"].includes(input.status)?input.status:"active",created_by:ctx.actorId,updated_at:new Date().toISOString()};
  if(row.purpose.length<5)throw new Error("PURPOSE_REQUIRED");
  const saved=mustData(input.id?await ctx.admin.from("ai_personal_data_uses").update(row).eq("id",input.id).eq("context_id",ctx.contextId).select().single():await ctx.admin.from("ai_personal_data_uses").insert(row).select().single(),"uso de IA");
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:"ai_use_saved",resourceType:"ai_personal_data_use",resourceId:saved.id,metadata:{automated_decision:row.automated_decision}});
  return saved;
}
