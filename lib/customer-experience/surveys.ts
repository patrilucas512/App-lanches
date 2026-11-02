/* eslint-disable @typescript-eslint/no-explicit-any */
/* Surveys and review requests. The official channels are injected, so routes, workers and tests share this code. */
import {createHash,randomBytes} from "node:crypto";

export const SURVEY_TRIGGERS=["order_delivered","order_picked_up","table_closed","reservation_completed","support_conversation_closed","subscription_cycle","manual"] as const;
export const SURVEY_CHANNELS=["whatsapp","qr_table","receipt_link","customer_portal","kiosk"] as const;
export const SKIP_REASONS=["opt_out","blocked","no_consent","frequency_cap","already_requested","already_answered","no_contact","no_open_window","channel_not_connected","channel_not_supported","expired"] as const;
export const DEFAULT_QUESTIONS:Record<string,any[]>={nps:[{id:"score",text:"De 0 a 10, o quanto você recomendaria esta loja?"},{id:"comment",text:"Quer contar o motivo? (opcional)",optional:true}],csat:[{id:"score",text:"Como foi sua experiência?"},{id:"comment",text:"Quer contar mais? (opcional)",optional:true}],ces:[{id:"score",text:"De 1 a 7, foi fácil fazer seu pedido?"},{id:"comment",text:"Quer contar mais? (opcional)",optional:true}]};
export const SCALE_OF:Record<string,string>={nps:"0-10",csat:"1-5",ces:"1-7"};

export const hashToken=(token:string)=>createHash("sha256").update(`cx-survey:${token}`).digest("hex");
export const newToken=()=>randomBytes(24).toString("base64url");
export const hashRequester=(value:string,secret:string)=>createHash("sha256").update(`${secret}:${value}`).digest("hex");

// The score is deliberately not an input: this function cannot gate the public invitation on a high rating.
export class ReviewInviteService{
  invite(input:{publicReviewUrl?:string|null}){const url=String(input.publicReviewUrl||"").trim();return/^https:\/\//.test(url)?{show:true,url}:{show:false,url:null}}
  // A detractor gets this as well as the invitation above: it is recovery, not a filter.
  contactOffer(input:{detractor:boolean;identified:boolean}){return input.detractor?{show:true,text:input.identified?"Sentimos muito. A equipe da loja vai entrar em contato para resolver.":"Sentimos muito. Se quiser retorno, fale com a loja pelos canais de atendimento."}:{show:false,text:null}}
}

export class SurveyEligibilityService{
  localHour(now:Date,timezone:string){return Number(new Intl.DateTimeFormat("en-US",{hour:"numeric",hour12:false,timeZone:timezone||"America/Sao_Paulo"}).format(now))%24}
  isQuiet(hour:number,start:number,end:number){return start===end?false:start<end?hour>=start&&hour<end:hour>=start||hour<end}
  // Hours until the quiet window ends, used to reschedule instead of dropping the survey.
  hoursUntilOpen(hour:number,end:number){return(end-hour+24)%24||24}
  evaluate(input:{expired?:boolean;alreadyAnswered?:boolean;alreadyRequested?:boolean;optedOut?:boolean;blocked?:boolean;requiresOptIn:boolean;marketingStatus?:string|null;lastSurveyAt?:string|null;maxFrequencyDays:number;localHour:number;quietStart:number;quietEnd:number;now?:number}){
    const now=input.now??Date.now();
    if(input.expired)return{decision:"skip",reason:"expired"};
    if(input.alreadyAnswered)return{decision:"skip",reason:"already_answered"};
    if(input.alreadyRequested)return{decision:"skip",reason:"already_requested"};
    if(input.blocked)return{decision:"skip",reason:"blocked"};
    if(input.optedOut||input.marketingStatus==="opted_out")return{decision:"skip",reason:"opt_out"};
    if(input.requiresOptIn&&input.marketingStatus!=="opted_in")return{decision:"skip",reason:"no_consent"};
    if(input.maxFrequencyDays>0&&input.lastSurveyAt&&now-Date.parse(input.lastSurveyAt)<input.maxFrequencyDays*864e5)return{decision:"skip",reason:"frequency_cap"};
    if(this.isQuiet(input.localHour,input.quietStart,input.quietEnd))return{decision:"delay",hours:this.hoursUntilOpen(input.localHour,input.quietEnd)};
    return{decision:"send"};
  }
}

export function surveyMessage(input:{storeName:string;surveyType:string;link:string}){
  const question=input.surveyType==="nps"?"De 0 a 10, o quanto você recomendaria nossa loja? Responda aqui com o número":input.surveyType==="ces"?"De 1 a 7, foi fácil fazer seu pedido? Responda aqui com o número":"De 1 a 5, como foi sua experiência? Responda aqui com o número";
  return`Obrigado pela preferência na ${input.storeName}! ${question} ou pelo link: ${input.link}\n\nSe não quiser receber mensagens, envie PARAR.`;
}

const WINDOW_MS=24*36e5,MAX_ATTEMPTS=3;

// Runs one due dispatch end to end. Failure stays on this row and never touches the order.
export async function processDispatch(ctx:{admin:any;siteUrl:string;send:(input:any)=>Promise<any>;now?:Date},dispatch:any){
  const{admin}=ctx,now=ctx.now||new Date(),eligibility=new SurveyEligibilityService(),{data:claim}=await admin.from("cx_survey_dispatches").update({status:"processing",attempts:dispatch.attempts+1,updated_at:now.toISOString()}).eq("id",dispatch.id).eq("status","queued").select("id").maybeSingle();
  if(!claim)return{status:"claimed_elsewhere"};
  const finish=async(status:string,extra:Record<string,unknown>={})=>{await admin.from("cx_survey_dispatches").update({status,updated_at:now.toISOString(),...extra}).eq("id",dispatch.id);return{status,...extra}};
  try{
    if(dispatch.channel!=="whatsapp")return finish("skipped",{skip_reason:"channel_not_supported"});
    const[{data:store},{data:settings},{data:definition},{data:customer},{data:contact},{data:preference},{data:last},{data:existing},{data:automation}]=await Promise.all([
      admin.from("establishments").select("name,menu_display_name,slug,timezone").eq("id",dispatch.store_id).maybeSingle(),
      admin.from("cx_settings").select("*").eq("organization_id",dispatch.organization_id).maybeSingle(),
      admin.from("cx_survey_definitions").select("*").eq("id",dispatch.definition_id).maybeSingle(),
      admin.from("customers").select("marketing_status").eq("id",dispatch.customer_id).maybeSingle(),
      admin.from("whatsapp_contacts").select("id,wa_id,marketing_opt_out,marketing_status,blocked_at,last_message_at").eq("establishment_id",dispatch.store_id).eq("customer_id",dispatch.customer_id).order("last_message_at",{ascending:false,nullsFirst:false}).limit(1).maybeSingle(),
      admin.from("customer_notification_preferences").select("whatsapp_marketing,transactional_enabled").eq("organization_id",dispatch.organization_id).eq("customer_id",dispatch.customer_id).maybeSingle(),
      admin.from("cx_survey_dispatches").select("sent_at").eq("organization_id",dispatch.organization_id).eq("customer_id",dispatch.customer_id).in("status",["sent","answered"]).not("sent_at","is",null).order("sent_at",{ascending:false}).limit(1).maybeSingle(),
      dispatch.order_id?admin.from("crm_feedback").select("id,answered_at").eq("order_id",dispatch.order_id).maybeSingle():{data:null},
      dispatch.order_id?admin.from("crm_relationship_outbox").select("id").eq("order_id",dispatch.order_id).eq("automation_type","post_sale").in("status",["pending","processing","sent"]).limit(1).maybeSingle():{data:null},
    ]);
    if(!contact)return finish("skipped",{skip_reason:"no_contact"});
    const decision=eligibility.evaluate({expired:Boolean(dispatch.expires_at&&Date.parse(dispatch.expires_at)<now.getTime()),alreadyAnswered:Boolean(existing?.answered_at),alreadyRequested:Boolean(automation),blocked:Boolean(contact.blocked_at),optedOut:Boolean(contact.marketing_opt_out)||preference?.whatsapp_marketing===false||preference?.transactional_enabled===false,requiresOptIn:settings?.survey_requires_opt_in!==false,marketingStatus:contact.marketing_status==="unknown"?customer?.marketing_status:contact.marketing_status,lastSurveyAt:last?.sent_at,maxFrequencyDays:definition?.max_frequency_days??settings?.max_survey_frequency_days??30,localHour:eligibility.localHour(now,store?.timezone),quietStart:settings?.quiet_start_hour??21,quietEnd:settings?.quiet_end_hour??9,now:now.getTime()}) as any;
    if(decision.decision==="skip")return finish(decision.reason==="expired"?"expired":"skipped",{skip_reason:decision.reason});
    if(decision.decision==="delay")return finish("queued",{scheduled_at:new Date(now.getTime()+decision.hours*36e5).toISOString(),attempts:dispatch.attempts});
    // A free-form WhatsApp message only reaches a customer inside the 24 hour window; an approved template is out of scope here.
    if(!contact.last_message_at||now.getTime()-Date.parse(contact.last_message_at)>WINDOW_MS)return finish("skipped",{skip_reason:"no_open_window"});
    const[{data:connection},{data:conversation}]=await Promise.all([admin.from("whatsapp_connections").select("id").eq("establishment_id",dispatch.store_id).eq("status","connected").limit(1).maybeSingle(),admin.from("whatsapp_conversations").select("id").eq("establishment_id",dispatch.store_id).eq("contact_id",contact.id).order("last_message_at",{ascending:false}).limit(1).maybeSingle()]);
    if(!connection||!conversation)return finish("skipped",{skip_reason:"channel_not_connected"});
    // The pending row carries the scale, so the attendant reads a reply of "9" against the right scale.
    const pending={establishment_id:dispatch.store_id,organization_id:dispatch.organization_id,customer_id:dispatch.customer_id,order_id:dispatch.order_id,whatsapp_contact_id:contact.id,scale:definition.scale,feedback_type:definition.survey_type,source:"whatsapp",channel:"whatsapp",consent_ref:`whatsapp_contact:${contact.id}`};
    let feedbackId=existing?.id||null;
    if(feedbackId){const{error}=await admin.from("crm_feedback").update({scale:definition.scale,feedback_type:definition.survey_type,whatsapp_contact_id:contact.id,consent_ref:pending.consent_ref}).eq("id",feedbackId).is("answered_at",null);if(error)throw error}
    else{const{data,error}=await admin.from("crm_feedback").insert(pending).select("id").single();if(error)throw error;feedbackId=data.id}
    const token=newToken(),link=`${ctx.siteUrl}/avaliar/${store.slug}?t=${token}`;
    await admin.from("cx_survey_dispatches").update({token_hash:hashToken(token),feedback_id:feedbackId}).eq("id",dispatch.id);
    await ctx.send({admin,establishmentId:dispatch.store_id,connectionId:connection.id,conversationId:conversation.id,contactId:contact.id,waId:contact.wa_id,text:surveyMessage({storeName:store.menu_display_name||store.name,surveyType:definition.survey_type,link}),clientRequestId:`cx-survey:${dispatch.id}`,automationGenerated:true});
    return finish("sent",{sent_at:now.toISOString(),error_message:null});
  }catch(error:any){
    const attempts=dispatch.attempts+1,done=attempts>=MAX_ATTEMPTS;
    return finish(done?"failed":"queued",{error_message:String(error?.message||"Falha no envio").slice(0,300),...(done?{}:{scheduled_at:new Date(now.getTime()+attempts*15*6e4).toISOString()})});
  }
}

export async function processDueDispatches(ctx:{admin:any;siteUrl:string;send:(input:any)=>Promise<any>;now?:Date},limit=50){
  const now=ctx.now||new Date(),{data}=await ctx.admin.from("cx_survey_dispatches").select("*").eq("status","queued").lte("scheduled_at",now.toISOString()).order("scheduled_at").limit(limit),results:any[]=[];
  for(const dispatch of data||[])results.push(await processDispatch(ctx,dispatch));
  return results;
}

// Staff-generated link for a receipt or a table. The raw token is returned once and only its hash is stored.
export async function createSurveyLink(ctx:any,input:{definitionId:string;channel:string;orderId?:string|null;customerId?:string|null;siteUrl:string}){
  const{data:definition}=await ctx.admin.from("cx_survey_definitions").select("id,version,trigger_type,status").eq("id",input.definitionId).eq("organization_id",ctx.organizationId).maybeSingle();
  if(!definition||definition.status!=="active")throw new Error("SURVEY_NOT_ACTIVE");
  let customerId=input.customerId||null;
  if(input.orderId){const{data:order}=await ctx.admin.from("orders").select("id,customer_id").eq("id",input.orderId).eq("establishment_id",ctx.storeId).maybeSingle();if(!order)throw new Error("ORDER_NOT_FOUND");customerId=order.customer_id}
  const token=newToken(),{data:store}=await ctx.admin.from("establishments").select("slug").eq("id",ctx.storeId).maybeSingle();
  const row={organization_id:ctx.organizationId,store_id:ctx.storeId,definition_id:definition.id,definition_version:definition.version,customer_id:customerId,order_id:input.orderId||null,trigger_type:"manual",channel:input.channel,token_hash:hashToken(token),status:"link_ready",expires_at:new Date(Date.now()+14*864e5).toISOString(),idempotency_key:input.orderId?`order:${input.orderId}`:`link:${crypto.randomUUID()}`,created_by:ctx.actorId};
  const{error}=await ctx.admin.from("cx_survey_dispatches").insert(row);
  if(error)throw new Error(error.code==="23505"?"SURVEY_ALREADY_REQUESTED":error.message);
  return{url:`${input.siteUrl}/avaliar/${store.slug}?t=${token}`,tokenStored:false};
}
