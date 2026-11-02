/* eslint-disable @typescript-eslint/no-explicit-any */
/* Responses always pass a human, except the narrow simple-case policy the organization has to switch on. AI only drafts. */
import {hasPii,maskPii} from "./core.ts";
import {aiDraftResponse} from "./ai.ts";
import {OFFICIAL_ADAPTERS,type ExternalReviewAdapter} from "./external.ts";
import {cxAudit,storeFlags} from "./server.ts";

export const DEFAULT_TEMPLATES:Array<{key:string;situation:string;body:string}>=[
  {key:"compliment",situation:"compliment",body:"Obrigado pela avaliação! Ficamos felizes com a sua experiência e esperamos receber você de novo."},
  {key:"neutral",situation:"neutral",body:"Obrigado por contar como foi. Sua opinião ajuda a melhorar o nosso atendimento."},
  {key:"complaint",situation:"complaint",body:"Sentimos muito pela sua experiência. Queremos entender o que aconteceu: fale com a nossa equipe pelos canais de atendimento."},
  {key:"delivery_issue",situation:"delivery_issue",body:"Sentimos muito pelo problema com a entrega. Fale com a nossa equipe pelos canais de atendimento para vermos o que aconteceu."},
  {key:"food_quality",situation:"food_quality",body:"Sentimos muito que o pedido não tenha ficado como esperado. Fale com a nossa equipe pelos canais de atendimento."},
  {key:"service_issue",situation:"service_issue",body:"Sentimos muito pelo atendimento que você recebeu. Fale com a nossa equipe pelos canais de atendimento."},
  {key:"risk_signal",situation:"risk_signal",body:"Levamos o seu relato muito a sério e a nossa equipe vai analisar o caso. Fale conosco pelos canais de atendimento."},
];

const COMPENSATION=/\b(reembols|estorn|cupom|desconto|devolv\w* (o )?dinheiro|brinde|de gra[cç]a|cortesia|compensa[cç])/i;
const CHANGE_REVIEW=/\b(remov|apag|mud|alter|retir|exclu)\w*\s+(a |sua |essa |esta )*(avalia[cç]|nota|coment[aá]rio|review)/i;

export class ResponseGuardService{
  // Runs on the text about to go public. Names and order numbers come from the record, because a regex cannot tell a customer's name from any other word.
  check(input:{text:string;channel:string;authorType:string;customerName?:string|null;orderNumber?:string|number|null}){
    const issues:string[]=[],text=input.text,isPublic=input.channel==="external_api";
    if(isPublic&&hasPii(text))issues.push("PII_IN_PUBLIC_RESPONSE");
    const first=String(input.customerName||"").trim().split(/\s+/)[0];
    if(isPublic&&first.length>=3&&new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}\\b`,"i").test(text))issues.push("PII_IN_PUBLIC_RESPONSE");
    if(isPublic&&input.orderNumber!=null&&String(input.orderNumber).length>=2&&new RegExp(`\\b${input.orderNumber}\\b`).test(text))issues.push("ORDER_REF_IN_PUBLIC_RESPONSE");
    if(input.authorType==="ai"&&COMPENSATION.test(text))issues.push("AI_COMPENSATION_PROMISE");
    if(CHANGE_REVIEW.test(text))issues.push("PRESSURE_TO_CHANGE_REVIEW");
    return{ok:issues.length===0,issues:[...new Set(issues)]};
  }
}

export class AutoPublishPolicy{
  // Narrow on purpose: a top rating, no text to misread, no risk signal, and the organization has turned it on.
  allows(input:{policyEnabled:boolean;score?:number|null;scale?:string|null;comment?:string|null;riskSignals:number;authorType:string}){
    return input.policyEnabled&&input.authorType==="template"&&input.scale==="1-5"&&Number(input.score)===5&&!String(input.comment||"").trim()&&input.riskSignals===0;
  }
}

export const situationFor=(input:{score?:number|null;scale?:string|null;topics?:string[];riskSignals?:number})=>{
  if(input.riskSignals)return"risk_signal";
  const topics=input.topics||[];
  if(topics.some(x=>["delivery_time","delivery_courier"].includes(x)))return"delivery_issue";
  if(topics.some(x=>["food_quality","temperature","portion","packaging"].includes(x)))return"food_quality";
  if(topics.includes("service"))return"service_issue";
  if(input.score==null)return"neutral";
  const score=Number(input.score),high=input.scale==="0-10"?9:input.scale==="1-7"?6:4,low=input.scale==="0-10"?6:input.scale==="1-7"?3:2;
  return score>=high?"compliment":score<=low?"complaint":"neutral";
};

async function loadFeedback(ctx:any,feedbackId:string){
  const{data}=await ctx.admin.from("crm_feedback").select("*,customers(name),orders(order_number),external_reviews(id,external_id,source_id)").eq("id",feedbackId).eq("organization_id",ctx.organizationId).in("establishment_id",ctx.storeIds).maybeSingle();
  if(!data)throw new Error("FEEDBACK_NOT_FOUND");
  return data;
}

export async function ensureTemplates(ctx:any){
  const{data:existing}=await ctx.admin.from("review_response_templates").select("key").eq("organization_id",ctx.organizationId),known=new Set((existing||[]).map((x:any)=>x.key)),fresh=DEFAULT_TEMPLATES.filter(x=>!known.has(x.key)).map(x=>({...x,organization_id:ctx.organizationId,created_by:ctx.actorId||null}));
  if(fresh.length)await ctx.admin.from("review_response_templates").insert(fresh);
}

export async function createDraft(ctx:any,input:{feedbackId:string;text?:string;channel:string;useAi?:boolean;templateId?:string|null}){
  const feedback=await loadFeedback(ctx,input.feedbackId);
  if(!["external_api","whatsapp","internal_note"].includes(input.channel))throw new Error("CHANNEL_INVALID");
  let draft=String(input.text||"").trim(),authorType="human",templateId=input.templateId||null;
  if(!draft&&input.useAi){
    const flags=await storeFlags(ctx.admin,feedback.establishment_id,["cx_ai_response_drafts_enabled"]);
    if(!flags.cx_ai_response_drafts_enabled)throw new Error("FEATURE_DISABLED");
    const{data:store}=await ctx.admin.from("establishments").select("name,menu_display_name").eq("id",feedback.establishment_id).maybeSingle(),text=await aiDraftResponse({admin:ctx.admin,organizationId:ctx.organizationId,storeId:feedback.establishment_id,fetcher:ctx.fetcher},{maskedComment:maskPii(feedback.comment),score:feedback.score==null?null:Number(feedback.score),brandName:store?.menu_display_name||store?.name||"nossa loja"});
    // An AI draft that makes a forbidden promise is thrown away and the template takes over, so a person never has to catch it.
    if(text&&new ResponseGuardService().check({text,channel:input.channel,authorType:"ai",customerName:feedback.customers?.name,orderNumber:feedback.orders?.order_number}).ok){draft=text.slice(0,1500);authorType="ai"}
  }
  if(!draft){
    await ensureTemplates(ctx);
    const[{data:topics},{count:risks}]=await Promise.all([ctx.admin.from("cx_feedback_topics").select("topic_key").eq("feedback_id",feedback.id).eq("polarity","negative").is("removed_at",null),ctx.admin.from("cx_risk_signals").select("id",{count:"exact",head:true}).eq("feedback_id",feedback.id).neq("status","dismissed")]);
    const query=ctx.admin.from("review_response_templates").select("id,body").eq("organization_id",ctx.organizationId).eq("status","active"),{data:template}=await(input.templateId?query.eq("id",input.templateId):query.eq("situation",situationFor({score:feedback.score==null?null:Number(feedback.score),scale:feedback.scale,topics:(topics||[]).map((x:any)=>x.topic_key),riskSignals:risks||0}))).limit(1).maybeSingle();
    if(!template)throw new Error("TEMPLATE_NOT_FOUND");
    draft=template.body;authorType="template";templateId=template.id;
  }
  const{data,error}=await ctx.admin.from("review_responses").insert({organization_id:ctx.organizationId,store_id:feedback.establishment_id,feedback_id:feedback.id,template_id:templateId,draft,author_type:authorType,author_id:authorType==="ai"?null:ctx.actorId,channel:input.channel,status:"pending_approval"}).select().single();
  if(error)throw new Error(error.message);
  if(["new","triaged"].includes(feedback.inbox_status))await ctx.admin.from("crm_feedback").update({inbox_status:"awaiting_response"}).eq("id",feedback.id);
  await cxAudit(ctx.admin,{organizationId:ctx.organizationId,storeId:feedback.establishment_id,actorId:ctx.actorId,action:"response_drafted",resourceType:"review_response",resourceId:data.id,metadata:{author_type:authorType,channel:input.channel}});
  return data;
}

async function deliver(ctx:any,response:any,feedback:any,adapters:Record<string,ExternalReviewAdapter>){
  if(response.channel==="internal_note")return{externalRef:null};
  if(response.channel==="external_api"){
    const external=Array.isArray(feedback.external_reviews)?feedback.external_reviews[0]:feedback.external_reviews;
    if(!external)throw new Error("NOT_AN_EXTERNAL_REVIEW");
    const{data:source}=await ctx.admin.from("external_review_sources").select("*").eq("id",external.source_id).eq("organization_id",ctx.organizationId).maybeSingle(),adapter=source&&adapters[source.provider];
    if(!adapter?.replyToReview||!source.can_reply)throw new Error("PROVIDER_CANNOT_REPLY");
    const sent=await adapter.replyToReview({source,externalId:external.external_id,text:response.draft});
    await ctx.admin.from("external_reviews").update({replied_at:new Date().toISOString()}).eq("id",external.id);
    return{externalRef:sent.externalRef};
  }
  if(!ctx.sendWhatsApp)throw new Error("CHANNEL_NOT_CONNECTED");
  const{data:contact}=await ctx.admin.from("whatsapp_contacts").select("id,wa_id,last_message_at,blocked_at,marketing_opt_out").eq("id",feedback.whatsapp_contact_id||"00000000-0000-0000-0000-000000000000").maybeSingle();
  if(!contact||contact.blocked_at)throw new Error("NO_CONTACT");
  if(!contact.last_message_at||Date.now()-Date.parse(contact.last_message_at)>864e5)throw new Error("NO_OPEN_WINDOW");
  const[{data:connection},{data:conversation}]=await Promise.all([ctx.admin.from("whatsapp_connections").select("id").eq("establishment_id",feedback.establishment_id).eq("status","connected").limit(1).maybeSingle(),ctx.admin.from("whatsapp_conversations").select("id").eq("establishment_id",feedback.establishment_id).eq("contact_id",contact.id).order("last_message_at",{ascending:false}).limit(1).maybeSingle()]);
  if(!connection||!conversation)throw new Error("CHANNEL_NOT_CONNECTED");
  await ctx.sendWhatsApp({admin:ctx.admin,establishmentId:feedback.establishment_id,connectionId:connection.id,conversationId:conversation.id,contactId:contact.id,waId:contact.wa_id,text:response.draft,sentByUserId:ctx.actorId,clientRequestId:`cx-response:${response.id}`});
  return{externalRef:null};
}

async function publish(ctx:any,response:any,feedback:any,adapters:Record<string,ExternalReviewAdapter>){
  const now=new Date().toISOString();
  try{
    const sent=await deliver(ctx,response,feedback,adapters),{data,error}=await ctx.admin.from("review_responses").update({status:"published",published_at:now,external_ref:sent.externalRef,failure_reason:null,updated_at:now}).eq("id",response.id).select().single();
    if(error)throw new Error(error.message);
    await ctx.admin.from("crm_feedback").update({inbox_status:feedback.inbox_status==="escalated"?"escalated":"responded",first_responded_at:feedback.first_responded_at||now}).eq("id",feedback.id);
    await cxAudit(ctx.admin,{organizationId:ctx.organizationId,storeId:feedback.establishment_id,actorId:ctx.actorId,action:"response_published",resourceType:"review_response",resourceId:response.id,metadata:{channel:response.channel,auto_policy:response.auto_policy===true}});
    return data;
  }catch(error:any){
    const{data}=await ctx.admin.from("review_responses").update({status:"failed",failure_reason:String(error.message).slice(0,300),updated_at:now}).eq("id",response.id).select().single();
    return data;
  }
}

export async function decideResponse(ctx:any,input:{responseId:string;decision:"approved"|"rejected";reason?:string;text?:string;adapters?:Record<string,ExternalReviewAdapter>}){
  const{data:response}=await ctx.admin.from("review_responses").select("*").eq("id",input.responseId).eq("organization_id",ctx.organizationId).in("store_id",ctx.storeIds).maybeSingle();
  if(!response)throw new Error("RESPONSE_NOT_FOUND");
  if(!["pending_approval","failed"].includes(response.status))throw new Error("RESPONSE_NOT_PENDING");
  const now=new Date().toISOString();
  if(input.decision==="rejected"){
    if(String(input.reason||"").trim().length<3)throw new Error("REASON_REQUIRED");
    const{data,error}=await ctx.admin.from("review_responses").update({status:"rejected",rejection_reason:input.reason,updated_at:now}).eq("id",response.id).select().single();
    if(error)throw new Error(error.message);
    await cxAudit(ctx.admin,{organizationId:ctx.organizationId,storeId:response.store_id,actorId:ctx.actorId,action:"response_rejected",resourceType:"review_response",resourceId:response.id,reason:input.reason});
    return data;
  }
  const feedback=await loadFeedback(ctx,response.feedback_id),text=String(input.text||response.draft).trim(),guard=new ResponseGuardService().check({text,channel:response.channel,authorType:response.author_type,customerName:feedback.customers?.name,orderNumber:feedback.orders?.order_number});
  if(!guard.ok)throw new Error(guard.issues.join(","));
  const{data:approved,error}=await ctx.admin.from("review_responses").update({status:"approved",draft:text,approved_by:ctx.actorId,approved_at:now,updated_at:now}).eq("id",response.id).in("status",["pending_approval","failed"]).select().single();
  if(error)throw new Error(error.message);
  return publish(ctx,approved,feedback,input.adapters||OFFICIAL_ADAPTERS);
}

// Only ever called for the simple case. Everything else stays in the approval queue.
export async function maybeAutoPublish(ctx:any,input:{feedbackId:string;adapters?:Record<string,ExternalReviewAdapter>}){
  const feedback=await loadFeedback(ctx,input.feedbackId),[{data:settings},{count:risks},{count:responses}]=await Promise.all([ctx.admin.from("cx_settings").select("auto_publish_simple").eq("organization_id",ctx.organizationId).maybeSingle(),ctx.admin.from("cx_risk_signals").select("id",{count:"exact",head:true}).eq("feedback_id",feedback.id),ctx.admin.from("review_responses").select("id",{count:"exact",head:true}).eq("feedback_id",feedback.id)]);
  if(responses||!feedback.is_public||!new AutoPublishPolicy().allows({policyEnabled:settings?.auto_publish_simple===true,score:feedback.score==null?null:Number(feedback.score),scale:feedback.scale,comment:feedback.comment,riskSignals:risks||0,authorType:"template"}))return null;
  await ensureTemplates(ctx);
  const{data:template}=await ctx.admin.from("review_response_templates").select("id,body").eq("organization_id",ctx.organizationId).eq("situation","compliment").eq("status","active").limit(1).maybeSingle();
  if(!template)return null;
  const{data:response,error}=await ctx.admin.from("review_responses").insert({organization_id:ctx.organizationId,store_id:feedback.establishment_id,feedback_id:feedback.id,template_id:template.id,draft:template.body,author_type:"template",channel:"external_api",status:"approved",auto_policy:true}).select().single();
  if(error)throw new Error(error.message);
  return publish(ctx,response,feedback,input.adapters||OFFICIAL_ADAPTERS);
}
