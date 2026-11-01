/* eslint-disable @typescript-eslint/no-explicit-any */
/* Read model of the module and the queue jobs. Queries always filter by organization and by the stores the actor can see. */
import {IMPORTED_SOURCES,ReviewInboxService,isDetractor,maskPii,summarizeFacts} from "./core.ts";
import {EXTERNAL_PROVIDERS,ExternalReviewSupportService,OFFICIAL_ADAPTERS,syncSource} from "./external.ts";
import {refreshRecoveryOutcomes} from "./recovery.ts";
import {ReputationService,buildRootCause,periodOf,responseMetrics} from "./reputation.ts";
import {maybeAutoPublish} from "./responses.ts";
import {analyzeFeedback,emitCxEvent,notifyCx} from "./server.ts";

export const SETTINGS_DEFAULTS={minimum_sample:10,survey_requires_opt_in:true,max_survey_frequency_days:30,quiet_start_hour:21,quiet_end_hour:9,response_sla_hours:48,recovery_due_hours:24,auto_publish_simple:false,compensation_limit_cents:0,public_review_links:{},topic_taxonomy:[],nps_drop_points:15,retention_days:null};
const LIMIT=1000;

export async function readFacts(admin:any,input:{organizationId:string;storeIds:string[];from:string;to:string}){
  const{data,error}=await admin.from("fact_cx_feedback").select("*").eq("organization_id",input.organizationId).in("store_id",input.storeIds).gte("metric_date",input.from).lte("metric_date",input.to);
  if(error)throw new Error(error.message);
  return data||[];
}

export async function cxDashboard(ctx:any,input:{days?:number}={}){
  const days=Math.min(365,Math.max(1,Number(input.days)||30)),period=periodOf(days),previous=periodOf(days,Date.now()-days*864e5),org=ctx.organizationId,stores=ctx.storeIds,sensitive=ctx.permissions.includes("cx:view_sensitive"),since=`${period.from}T00:00:00Z`;
  const scoped=(table:string,columns="*",limit=200)=>ctx.admin.from(table).select(columns).eq("organization_id",org).in("store_id",stores).limit(limit);
  const[settingsRow,storeRows,facts,previousFacts,inbox,analysis,topics,risks,definitions,dispatches,sources,externals,responses,templates,cases,actions,corrections,coupons]=await Promise.all([
    ctx.admin.from("cx_settings").select("*").eq("organization_id",org).maybeSingle(),
    ctx.admin.from("establishments").select("id,name,slug,network_brand_id").eq("organization_id",org).in("id",stores),
    readFacts(ctx.admin,{organizationId:org,storeIds:stores,...period}),
    readFacts(ctx.admin,{organizationId:org,storeIds:stores,...previous}),
    ctx.admin.from("crm_feedback").select("id,establishment_id,customer_id,order_id,source,channel,feedback_type,score,scale,comment,is_public,inbox_status,owner_user_id,needs_human_attention,answered_at,response_due_at,first_responded_at,resolved_at,dimension_ratings,customers(name),orders(order_number)").eq("organization_id",org).in("establishment_id",stores).not("answered_at","is",null).gte("answered_at",since).order("answered_at",{ascending:false}).limit(LIMIT),
    scoped("cx_feedback_analysis","feedback_id,sentiment,confidence,evidence,method",LIMIT),
    scoped("cx_feedback_topics","feedback_id,topic_key,polarity,excerpt,confidence,origin,removed_at",LIMIT*2),
    scoped("cx_risk_signals","*",LIMIT).order("created_at",{ascending:false}),
    ctx.admin.from("cx_survey_definitions").select("*").eq("organization_id",org).order("key").order("version",{ascending:false}).limit(100),
    scoped("cx_survey_dispatches","status,skip_reason,channel,trigger_type,created_at",LIMIT).gte("created_at",since),
    scoped("external_review_sources","id,store_id,provider,status,support_reason,can_reply,last_sync_at,last_error,circuit_open_until,retain_text"),
    scoped("external_reviews","feedback_id,source_id,provider_url,author_label,provider_rating,replied_at",LIMIT),
    scoped("review_responses","*",200).order("created_at",{ascending:false}),
    ctx.admin.from("review_response_templates").select("*").eq("organization_id",org).order("key"),
    scoped("service_recovery_cases","*,customers(name)",200).order("created_at",{ascending:false}),
    ctx.admin.from("service_recovery_actions").select("*").eq("organization_id",org).order("created_at",{ascending:false}).limit(300),
    ctx.admin.from("cx_analysis_corrections").select("correction_type,after_value,created_at").eq("organization_id",org).order("created_at",{ascending:false}).limit(50),
    ctx.admin.from("coupons").select("id,code,establishment_id").in("establishment_id",stores).eq("active",true).limit(100),
  ]);
  const settings={...SETTINGS_DEFAULTS,...(settingsRow.data||{})},minimumSample=settings.minimum_sample,summary=summarizeFacts(facts,minimumSample),before=summarizeFacts(previousFacts,minimumSample),reputationService=new ReputationService(),feedbackRows=inbox.data||[];
  const analysisBy=new Map((analysis.data||[]).map((x:any)=>[x.feedback_id,x])),topicBy=new Map<string,any[]>(),riskBy=new Map<string,any[]>(),externalBy=new Map((externals.data||[]).map((x:any)=>[x.feedback_id,x])),inboxService=new ReviewInboxService();
  for(const topic of topics.data||[])if(!topic.removed_at)topicBy.set(topic.feedback_id,[...(topicBy.get(topic.feedback_id)||[]),topic]);
  const riskRows=(risks.data||[]).map((x:any)=>sensitive?x:{...x,excerpt:x.excerpt?"[restrito]":null,review_reason:null});
  for(const risk of riskRows)riskBy.set(risk.feedback_id,[...(riskBy.get(risk.feedback_id)||[]),risk]);
  const liveCases=(cases.data||[]);
  const inboxRows=feedbackRows.map((x:any)=>({...x,comment:sensitive?x.comment:maskPii(x.comment),customer_name:sensitive?x.customers?.name||null:x.customer_id?"[restrito]":null,order_number:x.orders?.order_number??null,customers:undefined,orders:undefined,analysis:analysisBy.get(x.id)||null,topics:topicBy.get(x.id)||[],risks:riskBy.get(x.id)||[],external:externalBy.get(x.id)||null,sla:inboxService.sla(x),detractor:isDetractor({score:x.score==null?null:Number(x.score),scale:x.scale,feedback_type:x.feedback_type})}));
  const topicCounts=new Map<string,{topic_key:string;count:number;negative:number}>();
  for(const list of topicBy.values())for(const topic of list){const entry=topicCounts.get(topic.topic_key)||{topic_key:topic.topic_key,count:0,negative:0};entry.count++;if(topic.polarity==="negative")entry.negative++;topicCounts.set(topic.topic_key,entry)}
  const{data:brands}=await ctx.admin.from("network_brands").select("id,name").eq("organization_id",org),brandName=new Map((brands||[]).map((x:any)=>[x.id,x.name])),storeList=(storeRows.data||[]).map((x:any)=>({...x,brand_name:brandName.get(x.network_brand_id)||null})),reputation=reputationService.byScope(facts,{minimumSample,stores:storeList}),trend=reputationService.npsTrend({current:summary.nps,previous:before.nps,dropPoints:settings.nps_drop_points}),metrics=responseMetrics(feedbackRows);
  const answeredDispatch=(dispatches.data||[]).filter((x:any)=>x.status==="answered").length,sentDispatch=(dispatches.data||[]).filter((x:any)=>["sent","answered"].includes(x.status)).length,recoveredCases=liveCases.filter((x:any)=>["resolved","closed"].includes(x.status)),provider=new ExternalReviewSupportService();
  const cards={nps:summary.nps,csat:summary.csat,externalAverage:summary.externalAverage,unanswered:feedbackRows.filter((x:any)=>x.is_public&&!x.first_responded_at&&!["closed","resolved"].includes(x.inbox_status)).length,detractorsWaiting:inboxRows.filter((x:any)=>x.detractor&&x.customer_id&&!x.first_responded_at&&!liveCases.some((c:any)=>c.feedback_id===x.id&&c.status!=="open")&&!["closed","resolved"].includes(x.inbox_status)).length,openRisks:(risks.data||[]).filter((x:any)=>x.status==="pending_review").length,medianResponseHours:metrics.medianResponseHours,responseSample:metrics.responseSample,recoveriesDone:recoveredCases.length};
  return{
    permissions:ctx.permissions,flags:ctx.flags,period,cards,stores:storeList,settings,
    reputation:{...summary,...reputation,minimumSample},trend,
    inbox:inboxRows,truncated:feedbackRows.length===LIMIT,
    topics:[...topicCounts.values()].sort((a,b)=>b.count-a.count),risks:riskRows,corrections:corrections.data||[],
    surveys:definitions.data||[],dispatchSummary:{sent:sentDispatch,answered:answeredDispatch,responseRate:sentDispatch?Math.round(answeredDispatch/sentDispatch*1000)/10:null,denominator:"pesquisas enviadas",skipped:Object.entries((dispatches.data||[]).filter((x:any)=>x.status==="skipped").reduce((all:any,x:any)=>({...all,[x.skip_reason||"outro"]:(all[x.skip_reason||"outro"]||0)+1}),{})).map(([reason,count])=>({id:reason,reason,count}))},
    sources:sources.data||[],providers:Object.entries(EXTERNAL_PROVIDERS).map(([key,value])=>({key,name:value.name,...provider.resolve(key)})),
    responses:(responses.data||[]).map((x:any)=>x),templates:templates.data||[],
    recovery:liveCases.map((x:any)=>({...x,customer_name:sensitive?x.customers?.name||null:x.customer_id?"[restrito]":null,customers:undefined,overdue:!["resolved","closed","cancelled"].includes(x.status)&&Date.parse(x.due_at)<Date.now(),actions:(actions.data||[]).filter((a:any)=>a.case_id===x.id)})),coupons:coupons.data||[],
    rootCause:await buildRootCause({admin:ctx.admin,organizationId:org,storeIds:stores},{days,minimumSample}),
    metrics:{...metrics,denominators:{nps:summary.nps.denominator,csat:summary.csat.denominator}},
  };
}

// Sweeps deadlines and measures outcomes. Deterministic event ids make a repeated run harmless.
export async function slaScan(ctx:{admin:any;organizationId:string;notify?:any}){
  const nowIso=new Date().toISOString(),[{data:settings},{data:stores},{data:overdueReviews},{data:overdueCases}]=await Promise.all([
    ctx.admin.from("cx_settings").select("minimum_sample,nps_drop_points").eq("organization_id",ctx.organizationId).maybeSingle(),
    ctx.admin.from("establishments").select("id").eq("organization_id",ctx.organizationId),
    ctx.admin.from("crm_feedback").select("id,establishment_id,score,scale,feedback_type").eq("organization_id",ctx.organizationId).eq("is_public",true).is("first_responded_at",null).not("answered_at","is",null).lt("response_due_at",nowIso).not("inbox_status","in","(closed,resolved)").limit(200),
    ctx.admin.from("service_recovery_cases").select("id,store_id,due_at").eq("organization_id",ctx.organizationId).not("status","in","(resolved,closed,cancelled)").lt("due_at",nowIso).limit(200),
  ]);
  for(const review of overdueReviews||[]){
    await emitCxEvent(ctx.admin,{organizationId:ctx.organizationId,storeId:review.establishment_id,event:"cx.public_review_unanswered",aggregateType:"crm_feedback",aggregateId:review.id,payload:{"feedback.id":review.id,"store.id":review.establishment_id,critical:isDetractor({score:review.score==null?null:Number(review.score),scale:review.scale,feedback_type:review.feedback_type})}});
    await notifyCx(ctx,{organizationId:ctx.organizationId,storeId:review.establishment_id,eventType:"cx.public_review_unanswered",sourceType:"crm_feedback",sourceId:review.id,title:"Avaliação pública sem resposta",summary:"O prazo de resposta venceu.",priority:"high",route:"/painel/clientes/experiencia?tab=Caixa de Avaliações"});
  }
  for(const item of overdueCases||[]){
    await emitCxEvent(ctx.admin,{organizationId:ctx.organizationId,storeId:item.store_id,event:"cx.recovery_overdue",aggregateType:"service_recovery_case",aggregateId:item.id,payload:{"case.id":item.id,"store.id":item.store_id}});
    await notifyCx(ctx,{organizationId:ctx.organizationId,storeId:item.store_id,eventType:"cx.recovery_overdue",sourceType:"service_recovery_case",sourceId:item.id,title:"Recuperação de cliente atrasada",summary:"O prazo do caso venceu.",priority:"high",route:"/painel/clientes/experiencia?tab=Recuperação de Clientes"});
  }
  const minimumSample=settings?.minimum_sample||SETTINGS_DEFAULTS.minimum_sample,dropPoints=settings?.nps_drop_points||SETTINGS_DEFAULTS.nps_drop_points,service=new ReputationService();let drops=0;
  for(const store of stores||[]){
    const[current,previous]=await Promise.all([readFacts(ctx.admin,{organizationId:ctx.organizationId,storeIds:[store.id],...periodOf(30)}),readFacts(ctx.admin,{organizationId:ctx.organizationId,storeIds:[store.id],...periodOf(30,Date.now()-30*864e5)})]),trend=service.npsTrend({current:summarizeFacts(current,minimumSample).nps,previous:summarizeFacts(previous,minimumSample).nps,dropPoints});
    if(trend.drop){drops++;const week=new Date().toISOString().slice(0,10);await emitCxEvent(ctx.admin,{organizationId:ctx.organizationId,storeId:store.id,event:"cx.nps_drop",aggregateType:"establishment",aggregateId:`${store.id}:${week}`,payload:{"store.id":store.id,change:trend.change}})}
  }
  const outcomes=await refreshRecoveryOutcomes(ctx);
  return{overdueReviews:(overdueReviews||[]).length,overdueCases:(overdueCases||[]).length,drops,repurchases:outcomes.updated};
}

export async function runCxJob(ctx:{admin:any;notify?:any;sendWhatsApp?:any},job:any){
  if(job.job_type==="analyze_feedback"){
    const result=await analyzeFeedback(ctx,job.payload.feedback_id),{data:feedback}=await ctx.admin.from("crm_feedback").select("id,establishment_id,customer_id,is_public,source").eq("id",job.payload.feedback_id).maybeSingle();
    if(feedback?.customer_id)await emitCxEvent(ctx.admin,{organizationId:job.organization_id,storeId:feedback.establishment_id,event:"cx.feedback_received",aggregateType:"crm_feedback",aggregateId:feedback.id,payload:{"feedback.id":feedback.id,"store.id":feedback.establishment_id,"customer.id":feedback.customer_id}});
    if(feedback?.is_public&&(IMPORTED_SOURCES as readonly string[]).includes(feedback.source))await maybeAutoPublish({admin:ctx.admin,organizationId:job.organization_id,storeIds:[feedback.establishment_id],actorId:null,permissions:[]},{feedbackId:feedback.id});
    return result;
  }
  if(job.job_type==="sla_scan")return slaScan({admin:ctx.admin,organizationId:job.organization_id,notify:ctx.notify});
  if(job.job_type==="sync_external"){
    const{data:sources}=await ctx.admin.from("external_review_sources").select("*").eq("organization_id",job.organization_id).in("status",["active","error"]),results:any[]=[];
    for(const source of sources||[])results.push(await syncSource({admin:ctx.admin,adapters:OFFICIAL_ADAPTERS},source));
    return{results};
  }
  throw new Error("JOB_TYPE_INVALID");
}

// Goals (Phase 55) and Reporting (Phase 54) read here, so a goal never sees a number the module itself would call insufficient.
export async function semanticExperienceMetric(admin:any,input:{metric:"csat"|"nps";organizationId:string;storeIds?:string[]|null;from:string;to:string}){
  let query=admin.from("fact_cx_feedback").select("*").eq("organization_id",input.organizationId).gte("metric_date",input.from).lte("metric_date",input.to);
  if(input.storeIds?.length)query=query.in("store_id",input.storeIds);
  const[{data,error},{data:settings}]=await Promise.all([query,admin.from("cx_settings").select("minimum_sample").eq("organization_id",input.organizationId).maybeSingle()]);
  if(error)throw error;
  const result=summarizeFacts(data||[],settings?.minimum_sample||SETTINGS_DEFAULTS.minimum_sample)[input.metric];
  return{actual:result.status==="ok"?result.value:null,status:result.status,responses:result.responses,denominator:result.denominator,dataAsOf:data?.length?new Date().toISOString():null,source:"fact_cx_feedback"};
}

export async function experienceReportRows(admin:any,input:{organizationId:string;storeIds:string[];from:string;to:string;limit:number}){
  const[rows,{data:settings}]=await Promise.all([readFacts(admin,input),admin.from("cx_settings").select("minimum_sample").eq("organization_id",input.organizationId).maybeSingle()]),minimumSample=settings?.minimum_sample||SETTINGS_DEFAULTS.minimum_sample,groups=new Map<string,any[]>();
  for(const row of rows){const key=`${row.metric_date}|${row.store_id}`;groups.set(key,[...(groups.get(key)||[]),row])}
  return[...groups].slice(0,input.limit).map(([key,list])=>{const[date,store]=key.split("|"),summary=summarizeFacts(list,minimumSample);return{date,store,nps:summary.nps.value,nps_responses:summary.nps.responses,nps_status:summary.nps.status,csat:summary.csat.value,csat_responses:summary.csat.responses,csat_status:summary.csat.status,minimum_sample:minimumSample}}).sort((a,b)=>a.date.localeCompare(b.date));
}
