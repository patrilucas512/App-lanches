/* eslint-disable @typescript-eslint/no-explicit-any */
/* Analysis pipeline. Runs from the queue, outside the writer's transaction, and every step is idempotent so a retry repeats nothing. */
import {CORRELATION_NOTICE,isDetractor,maskPii} from "./core.ts";
import {aiAnalyze} from "./ai.ts";
import {RISK_LABELS,SentimentTopicService,mergeAiAnalysis,routeForSignal} from "./sentiment.ts";

export {CORRELATION_NOTICE};
const must=<T>(result:{data:T;error:any},step:string):T=>{if(result.error)throw new Error(`${step}: ${result.error.message}`);return result.data};

export async function cxAudit(admin:any,input:{organizationId:string;storeId?:string|null;actorId?:string|null;actorType?:string;action:string;resourceType:string;resourceId?:string|null;reason?:string|null;metadata?:Record<string,unknown>}){
  await Promise.all([
    admin.from("cx_audit_events").insert({organization_id:input.organizationId,store_id:input.storeId||null,actor_id:input.actorId||null,actor_type:input.actorType||(input.actorId?"user":"system"),action:input.action,resource_type:input.resourceType,resource_id:input.resourceId||null,reason:input.reason||null,safe_metadata:input.metadata||{}}),
    admin.from("security_audit_logs").insert({actor_user_id:input.actorId||null,organization_id:input.organizationId,action:`cx.${input.action}`,target_type:input.resourceType,target_id:input.resourceId||null,after_state:input.metadata||{},correlation_id:crypto.randomUUID()}),
  ]);
}

export async function storeFlags(admin:any,storeId:string,flags:readonly string[]){
  const[{data:row},{data:subscription}]=await Promise.all([admin.from("store_feature_flags").select(flags.join(",")).eq("establishment_id",storeId).maybeSingle(),admin.from("subscriptions").select(`plans(${flags.join(",")})`).eq("establishment_id",storeId).in("status",["active","trialing","past_due"]).order("created_at",{ascending:false}).limit(1).maybeSingle()]);
  const plan=(subscription as any)?.plans;
  return Object.fromEntries(flags.map(flag=>[flag,(row as any)?.[flag]===true||plan?.[flag]===true])) as Record<string,boolean>;
}

// Event ids are deterministic, so a retried job never delivers the same event twice to Automation or Journeys.
export async function emitCxEvent(admin:any,input:{organizationId:string;storeId?:string|null;event:string;aggregateType:string;aggregateId:string;payload?:Record<string,unknown>}){
  const{error}=await admin.from("automation_event_inbox").upsert({id:`${input.event}:${input.aggregateId}`,organization_id:input.organizationId,store_id:input.storeId||null,event_name:input.event,schema_version:1,aggregate_type:input.aggregateType,aggregate_id:input.aggregateId,payload:input.payload||{},correlation_id:crypto.randomUUID()},{onConflict:"id",ignoreDuplicates:true});
  if(error)throw new Error(`evento ${input.event}: ${error.message}`);
}

async function managers(admin:any,organizationId:string,storeId:string){
  const[{data:org},{data:store}]=await Promise.all([admin.from("organization_members").select("user_id").eq("organization_id",organizationId).in("role",["owner","admin"]).eq("active",true),admin.from("establishment_members").select("user_id").eq("establishment_id",storeId).in("role",["owner","manager"]).eq("status","active")]);
  return[...new Set([...(org||[]),...(store||[])].map((x:any)=>x.user_id))] as string[];
}

export async function notifyCx(ctx:{admin:any;notify?:any},input:{organizationId:string;storeId:string;eventType:string;sourceType:string;sourceId:string;title:string;summary:string;priority:string;route:string}){
  if(!ctx.notify)return;
  for(const userId of await managers(ctx.admin,input.organizationId,input.storeId))await ctx.notify(ctx.admin,{organizationId:input.organizationId,storeId:input.storeId,eventType:input.eventType,sourceType:input.sourceType,sourceId:input.sourceId,title:input.title,summary:input.summary,priority:input.priority,recipientUserId:userId,route:input.route} as any);
}

// Opens the occurrence in the module that owns it. The comment stays here and the incident gets only the masked excerpt.
export async function routeRiskSignal(ctx:{admin:any;notify?:any},signal:any,feedback:any){
  const route=routeForSignal(signal.signal_type),label=RISK_LABELS[signal.signal_type],summary=`Sinal detectado em avaliação de cliente, aguardando revisão humana. Trecho: "${signal.excerpt||"sem trecho"}"`;let nonconformityId=signal.nonconformity_id||null,incidentId=signal.incident_id||null;
  if(route.nonconformity&&!nonconformityId){
    const{data:existing}=await ctx.admin.from("quality_nonconformities").select("id").eq("organization_id",signal.organization_id).eq("source_type","customer_experience").eq("source_id",signal.id).maybeSingle();
    nonconformityId=existing?.id||(must(await ctx.admin.from("quality_nonconformities").insert({organization_id:signal.organization_id,store_id:signal.store_id,source_type:"customer_experience",source_id:signal.id,category:route.nonconformity.category,severity:route.nonconformity.severity,title:`Reclamação de cliente: ${label}`,description:summary}).select("id").single(),"abrir não conformidade") as any).id;
  }
  if(!incidentId){
    const key=`cx:risk:${signal.id}`,{data:existing}=await ctx.admin.from("operational_incidents").select("id").eq("organization_id",signal.organization_id).eq("idempotency_key",key).maybeSingle();
    incidentId=existing?.id;
    if(!incidentId){
      const incident=must(await ctx.admin.from("operational_incidents").insert({organization_id:signal.organization_id,store_id:signal.store_id,incident_number:`INC-${new Date().getFullYear()}-${crypto.randomUUID().slice(0,8).toUpperCase()}`,title:`${label} relatado por cliente`,summary,category:route.incident.category,severity:route.incident.severity,severity_reason:"Sinal de risco em avaliação; a gravidade final depende da revisão humana.",status:"detected",visibility:route.incident.visibility,source_type:"customer_experience",source_id:signal.id,idempotency_key:key,detected_at:new Date().toISOString()}).select("id").single(),"abrir incidente") as any;
      incidentId=incident.id;
      await ctx.admin.from("incident_timeline_events").insert({incident_id:incidentId,event_type:"detected",event_time:new Date().toISOString(),source_type:"customer_experience",source_id:signal.id,summary:"Aberto automaticamente a partir de avaliação de cliente.",visibility:route.incident.visibility});
    }
  }
  must(await ctx.admin.from("cx_risk_signals").update({nonconformity_id:nonconformityId,incident_id:incidentId,routing_error:null}).eq("id",signal.id),"ligar ocorrência");
  await ctx.admin.from("crm_feedback").update({needs_human_attention:true,inbox_status:"escalated"}).eq("id",feedback.id);
  await emitCxEvent(ctx.admin,{organizationId:signal.organization_id,storeId:signal.store_id,event:"cx.risk_signal_detected",aggregateType:"cx_risk_signal",aggregateId:signal.id,payload:{"signal.id":signal.id,"signal.type":signal.signal_type,"store.id":signal.store_id}});
  await notifyCx(ctx,{organizationId:signal.organization_id,storeId:signal.store_id,eventType:"cx.risk_signal_detected",sourceType:"cx_risk_signal",sourceId:signal.id,title:`Sinal de risco: ${label}`,summary:"Uma avaliação pede revisão humana.",priority:"critical",route:"/painel/clientes/experiencia?tab=Caixa de Avaliações"});
  return{nonconformityId,incidentId};
}

export async function openRecoveryCase(ctx:{admin:any},feedback:any,input:{reason:string;ownerId?:string|null;dueHours:number}){
  const{data:live}=await ctx.admin.from("service_recovery_cases").select("*").eq("feedback_id",feedback.id).not("status","in","(closed,cancelled)").maybeSingle();
  if(live)return{recoveryCase:live,created:false};
  const{data,error}=await ctx.admin.from("service_recovery_cases").insert({organization_id:feedback.organization_id,store_id:feedback.establishment_id,feedback_id:feedback.id,customer_id:feedback.customer_id,reason:input.reason,owner_user_id:input.ownerId||null,due_at:new Date(Date.now()+input.dueHours*36e5).toISOString()}).select().single();
  if(error)throw new Error(error.message);
  if(!["escalated"].includes(feedback.inbox_status))await ctx.admin.from("crm_feedback").update({inbox_status:"recovery_in_progress"}).eq("id",feedback.id);
  return{recoveryCase:data,created:true};
}

export async function analyzeFeedback(ctx:{admin:any;notify?:any;fetcher?:typeof fetch},feedbackId:string){
  const{data:feedback}=await ctx.admin.from("crm_feedback").select("*").eq("id",feedbackId).maybeSingle();
  if(!feedback||!feedback.answered_at)return{status:"skipped"};
  const[{data:settings},flags,{data:previous},{data:removed}]=await Promise.all([
    ctx.admin.from("cx_settings").select("*").eq("organization_id",feedback.organization_id).maybeSingle(),
    storeFlags(ctx.admin,feedback.establishment_id,["cx_ai_sentiment_enabled","cx_service_recovery_enabled"]),
    ctx.admin.from("cx_feedback_analysis").select("method,sentiment,confidence,evidence,corrected_by").eq("feedback_id",feedback.id).maybeSingle(),
    ctx.admin.from("cx_feedback_topics").select("topic_key").eq("feedback_id",feedback.id).or("removed_at.not.is.null,origin.eq.human"),
  ]);
  let analysis:any=new SentimentTopicService().analyze({comment:feedback.comment,score:feedback.score==null?null:Number(feedback.score),scale:feedback.scale,dimensionRatings:feedback.dimension_ratings,taxonomy:settings?.topic_taxonomy||[]}),aiRun=null;
  const masked=maskPii(feedback.comment);
  if(flags.cx_ai_sentiment_enabled){const ai=await aiAnalyze({admin:ctx.admin,organizationId:feedback.organization_id,storeId:feedback.establishment_id,fetcher:ctx.fetcher},masked);if(ai){analysis=mergeAiAnalysis(analysis,ai.parsed,masked);aiRun=ai.runId}}
  // A human correction is never overwritten silently: reanalysis keeps it and only refreshes what came from rules.
  const corrected=previous?.method==="human";
  must(await ctx.admin.from("cx_feedback_analysis").upsert({feedback_id:feedback.id,organization_id:feedback.organization_id,store_id:feedback.establishment_id,sentiment:corrected?previous.sentiment:analysis.sentiment,confidence:corrected?previous.confidence:analysis.confidence,evidence:analysis.evidence,method:corrected?"human":analysis.method,ai_run_ref:aiRun,corrected_by:corrected?previous.corrected_by:null,analyzed_at:new Date().toISOString()},{onConflict:"feedback_id"}),"gravar análise");
  const keep=new Set((removed||[]).map((x:any)=>x.topic_key)),topics=analysis.topics.filter((x:any)=>!keep.has(x.topic_key)).map((x:any)=>({...x,feedback_id:feedback.id,organization_id:feedback.organization_id,store_id:feedback.establishment_id}));
  if(topics.length)must(await ctx.admin.from("cx_feedback_topics").upsert(topics,{onConflict:"feedback_id,topic_key"}),"gravar temas");
  const routed:string[]=[];
  for(const risk of analysis.risks){
    const{data:existing}=await ctx.admin.from("cx_risk_signals").select("*").eq("feedback_id",feedback.id).eq("signal_type",risk.signal_type).maybeSingle();
    if(existing?.status==="dismissed")continue;
    const signal:any=existing||must(await ctx.admin.from("cx_risk_signals").insert({...risk,status:"pending_review",feedback_id:feedback.id,organization_id:feedback.organization_id,store_id:feedback.establishment_id}).select().single(),"gravar sinal");
    if(!signal.incident_id)try{await routeRiskSignal(ctx,signal,feedback);routed.push(signal.signal_type)}catch(error:any){await ctx.admin.from("cx_risk_signals").update({routing_error:String(error.message).slice(0,300)}).eq("id",signal.id);throw error}
  }
  const detractor=isDetractor(feedback);
  if(detractor&&feedback.customer_id){
    await emitCxEvent(ctx.admin,{organizationId:feedback.organization_id,storeId:feedback.establishment_id,event:"cx.detractor_received",aggregateType:"crm_feedback",aggregateId:feedback.id,payload:{"feedback.id":feedback.id,"store.id":feedback.establishment_id,"customer.id":feedback.customer_id}});
    if(flags.cx_service_recovery_enabled){const{created}=await openRecoveryCase(ctx,feedback,{reason:analysis.topics.filter((x:any)=>x.polarity==="negative").map((x:any)=>x.topic_key).join(", ")||"Avaliação baixa",dueHours:settings?.recovery_due_hours||24});if(created)await notifyCx(ctx,{organizationId:feedback.organization_id,storeId:feedback.establishment_id,eventType:"cx.detractor_received",sourceType:"crm_feedback",sourceId:feedback.id,title:"Cliente insatisfeito para retornar",summary:"Um caso de recuperação foi aberto.",priority:"high",route:"/painel/clientes/experiencia?tab=Recuperação de Clientes"})}
  }
  return{status:"analyzed",sentiment:analysis.sentiment,topics:topics.length,risks:analysis.risks.length,routed,detractor};
}

export async function reviewRiskSignal(ctx:any,input:{signalId:string;decision:"confirmed"|"dismissed";reason:string}){
  if(input.reason.trim().length<3)throw new Error("REASON_REQUIRED");
  const{data:signal}=await ctx.admin.from("cx_risk_signals").select("*").eq("id",input.signalId).eq("organization_id",ctx.organizationId).in("store_id",ctx.storeIds).maybeSingle();
  if(!signal)throw new Error("SIGNAL_NOT_FOUND");
  if(signal.status!=="pending_review")throw new Error("SIGNAL_ALREADY_REVIEWED");
  const now=new Date().toISOString(),{data,error}=await ctx.admin.from("cx_risk_signals").update({status:input.decision,reviewed_by:ctx.actorId,reviewed_at:now,review_reason:input.reason}).eq("id",signal.id).eq("status","pending_review").select().single();
  if(error)throw new Error(error.message);
  // A dismissal closes only what nobody has started working on. Anything already in progress stays with its owner, in its own module.
  if(input.decision==="dismissed"){
    if(signal.incident_id){const{data:cancelled}=await ctx.admin.from("operational_incidents").update({status:"cancelled",updated_at:now}).eq("id",signal.incident_id).eq("status","detected").select("id").maybeSingle();if(cancelled)await ctx.admin.from("incident_timeline_events").insert({incident_id:signal.incident_id,event_type:"status_changed",event_time:now,actor_user_id:ctx.actorId,source_type:"customer_experience",source_id:signal.id,summary:"Cancelado: o sinal foi descartado na revisão humana.",visibility:"restricted"})}
    if(signal.nonconformity_id)await ctx.admin.from("quality_nonconformities").update({status:"closed",resolved_at:now}).eq("id",signal.nonconformity_id).eq("status","open");
  }
  await cxAudit(ctx.admin,{organizationId:ctx.organizationId,storeId:signal.store_id,actorId:ctx.actorId,action:"risk_signal_reviewed",resourceType:"cx_risk_signal",resourceId:signal.id,reason:input.reason,metadata:{decision:input.decision,signal_type:signal.signal_type}});
  return data;
}

export async function correctAnalysis(ctx:any,input:{feedbackId:string;type:"sentiment"|"topic_added"|"topic_removed";value:string;reason:string}){
  if(input.reason.trim().length<3)throw new Error("REASON_REQUIRED");
  const{data:feedback}=await ctx.admin.from("crm_feedback").select("id,organization_id,establishment_id").eq("id",input.feedbackId).eq("organization_id",ctx.organizationId).in("establishment_id",ctx.storeIds).maybeSingle();
  if(!feedback)throw new Error("FEEDBACK_NOT_FOUND");
  let before:string|null=null;
  if(input.type==="sentiment"){
    if(!["positive","neutral","negative","mixed"].includes(input.value))throw new Error("SENTIMENT_INVALID");
    const{data:current}=await ctx.admin.from("cx_feedback_analysis").select("sentiment").eq("feedback_id",feedback.id).maybeSingle();before=current?.sentiment||null;
    must(await ctx.admin.from("cx_feedback_analysis").upsert({feedback_id:feedback.id,organization_id:feedback.organization_id,store_id:feedback.establishment_id,sentiment:input.value,confidence:"high",method:"human",corrected_by:ctx.actorId,analyzed_at:new Date().toISOString()},{onConflict:"feedback_id"}),"corrigir sentimento");
  }else if(input.type==="topic_added"){
    if(!/^[a-z_]{2,40}$/.test(input.value))throw new Error("TOPIC_INVALID");
    must(await ctx.admin.from("cx_feedback_topics").upsert({feedback_id:feedback.id,organization_id:feedback.organization_id,store_id:feedback.establishment_id,topic_key:input.value,confidence:"high",origin:"human",removed_at:null,removed_by:null},{onConflict:"feedback_id,topic_key"}),"adicionar tema");
  }else{
    must(await ctx.admin.from("cx_feedback_topics").update({removed_at:new Date().toISOString(),removed_by:ctx.actorId}).eq("feedback_id",feedback.id).eq("topic_key",input.value),"remover tema");
  }
  must(await ctx.admin.from("cx_analysis_corrections").insert({feedback_id:feedback.id,organization_id:feedback.organization_id,correction_type:input.type,before_value:before,after_value:input.value,reason:input.reason,corrected_by:ctx.actorId}),"registrar correção");
  await cxAudit(ctx.admin,{organizationId:ctx.organizationId,storeId:feedback.establishment_id,actorId:ctx.actorId,action:"analysis_corrected",resourceType:"crm_feedback",resourceId:feedback.id,reason:input.reason,metadata:{type:input.type,value:input.value}});
  return{ok:true};
}

export async function logStaffFeedback(ctx:any,input:{customerId?:string|null;orderId?:string|null;conversationRef?:string|null;type:string;comment:string;score?:number|null}){
  const comment=input.comment.trim();
  if(comment.length<3)throw new Error("COMMENT_REQUIRED");
  if(!["complaint","compliment","open_comment"].includes(input.type))throw new Error("TYPE_INVALID");
  const rating=input.score==null||input.score===("" as unknown)?null:Number(input.score);
  if(rating!=null&&!(Number.isInteger(rating)&&rating>=1&&rating<=5))throw new Error("SCORE_INVALID");
  // Staff never writes a score on the customer's behalf without the customer having said it; it stays optional.
  const row={establishment_id:ctx.storeId,organization_id:ctx.organizationId,customer_id:input.customerId||null,order_id:input.orderId||null,conversation_ref:input.conversationRef||null,comment:comment.slice(0,2000),rating,feedback_type:input.type,source:"staff_logged",channel:"staff_logged",answered_at:new Date().toISOString(),needs_human_attention:input.type==="complaint"};
  const{data,error}=await ctx.admin.from("crm_feedback").insert(row).select("id").single();
  if(error)throw new Error(error.code==="23505"?"ORDER_ALREADY_HAS_FEEDBACK":error.message);
  await cxAudit(ctx.admin,{organizationId:ctx.organizationId,storeId:ctx.storeId,actorId:ctx.actorId,action:"feedback_logged",resourceType:"crm_feedback",resourceId:data.id,metadata:{type:input.type}});
  return data;
}

// Complaint heard in a conversation becomes feedback. Best effort: it is called from the attendant, and a failure here must never break the reply.
export async function recordConversationComplaint(admin:any,input:{establishmentId:string;contactId?:string|null;conversationId:string;text:string}){
  try{
    const[{data:store},{data:contact},{data:recent}]=await Promise.all([admin.from("establishments").select("organization_id").eq("id",input.establishmentId).maybeSingle(),input.contactId?admin.from("whatsapp_contacts").select("customer_id").eq("id",input.contactId).eq("establishment_id",input.establishmentId).maybeSingle():{data:null},admin.from("crm_feedback").select("id").eq("establishment_id",input.establishmentId).eq("conversation_ref",input.conversationId).gte("created_at",new Date(Date.now()-864e5).toISOString()).limit(1).maybeSingle()]);
    if(!store||recent)return null;
    const flags=await storeFlags(admin,input.establishmentId,["customer_experience_enabled"]);
    if(!flags.customer_experience_enabled)return null;
    const{data}=await admin.from("crm_feedback").insert({establishment_id:input.establishmentId,organization_id:store.organization_id,customer_id:contact?.customer_id||null,whatsapp_contact_id:input.contactId||null,conversation_ref:input.conversationId,comment:input.text.slice(0,2000),feedback_type:"complaint",source:"whatsapp",channel:"whatsapp",answered_at:new Date().toISOString(),needs_human_attention:true}).select("id").maybeSingle();
    return data?.id||null;
  }catch{return null}
}
