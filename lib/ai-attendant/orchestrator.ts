import { createAdminClient } from "@/lib/supabase/admin";
import { sendStoredWhatsAppText } from "@/lib/whatsapp/message-service";
import { routeByRules } from "./intent-router";
import { availableTools, executeMasterAppTool } from "./masterapp-tools";
import { getAIProvider } from "./providers";
import { processConversationalOrder } from "./order-conversation";
import { findComplementaryKnowledge, getAIQuotaState, loadActiveAIConfig, normalizedLearningTopic, shapeAnswer } from "./config";
import type { ConversationTurn, IntentDecision } from "./types";

type Connection = {
  id:string; establishment_id:string; organization_id:string; routing_mode:"store"|"organization_selector"; ai_enabled:boolean; automatic_replies_enabled:boolean;
  human_handoff_enabled:boolean; ai_outside_business_hours:boolean; ai_attendant_name:string;
  ai_welcome_message:string; ai_fallback_message:string; ai_rate_limit_per_minute:number;
};

async function logEvent(admin: ReturnType<typeof createAdminClient>, connection:Connection, input:Record<string,unknown>) {
  await admin.from("whatsapp_automation_events").insert({establishment_id:connection.establishment_id,connection_id:connection.id,...input});
}

async function logUsage(admin:ReturnType<typeof createAdminClient>,connection:Connection,input:Record<string,unknown>){
  await admin.from("ai_usage_events").insert({establishment_id:connection.establishment_id,...input});
}

function configuredHandoff(text:string,rules:Record<string,boolean>){
  const checks:Array<[string,RegExp]>=[
    ["customer_requests_human",/\b(atendente|humano|pessoa|gerente)\b/i],["complaint",/\b(reclama|péssim|pessim|horrível|horrivel)\b/i],
    ["refund",/\b(reembolso|estorno|devolver.*dinheiro)\b/i],["payment_problem",/\b(pagamento.*(erro|falh|problema)|cobrança.*indevida)\b/i],
    ["late_order",/\b(pedido.*(atras|demor)|não chegou|nao chegou)\b/i],["wrong_order",/\b(pedido.*errado|veio errado|faltou item)\b/i],
    ["irritated",/\b(absurdo|raiva|irritad|processo vocês|procon)\b/i],
  ];
  return checks.some(([key,pattern])=>rules[key]&&pattern.test(text));
}

async function isWithinBusinessHours(admin: ReturnType<typeof createAdminClient>, establishmentId:string) {
  const [{data:settings},{data:modes},{data:hours}]=await Promise.all([
    admin.from("establishment_settings").select("timezone").eq("establishment_id",establishmentId).single(),
    admin.from("service_modes").select("store_open").eq("establishment_id",establishmentId).maybeSingle(),
    admin.from("business_hours").select("weekday,opens_at,closes_at,closed").eq("establishment_id",establishmentId),
  ]);
  if (modes?.store_open===false) return false;
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:settings?.timezone||"America/Sao_Paulo",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());
  const day=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(parts.find((p)=>p.type==="weekday")?.value||"Sun");
  const time=`${parts.find((p)=>p.type==="hour")?.value||"00"}:${parts.find((p)=>p.type==="minute")?.value||"00"}:00`;
  const today=(hours||[]).find((row:Record<string,any>)=>row.weekday===day);
  return Boolean(today&&!today.closed&&today.opens_at&&today.closes_at&&time>=today.opens_at&&time<=today.closes_at);
}

export async function processWhatsAppAutomation(input:{connectionId:string;messageId:string}) {
  const started=Date.now();
  const admin=createAdminClient();
  const {data:connectionData}=await admin.from("whatsapp_connections").select("id,establishment_id,organization_id,routing_mode,ai_enabled,automatic_replies_enabled,human_handoff_enabled,ai_outside_business_hours,ai_attendant_name,ai_welcome_message,ai_fallback_message,ai_rate_limit_per_minute").eq("id",input.connectionId).eq("status","connected").maybeSingle();
  const connection=connectionData as Connection|null;
  if (!connection) return;
  const {data:message}=await admin.from("whatsapp_messages").select("id,conversation_id,contact_id,content,message_type,message_timestamp,whatsapp_conversations(status,human_controlled,selected_store_id),whatsapp_contacts(wa_id,profile_name,name)").eq("id",input.messageId).eq("establishment_id",connection.establishment_id).eq("direction","inbound").maybeSingle();
  if (!message) return;
  const conversation=Array.isArray(message.whatsapp_conversations)?message.whatsapp_conversations[0]:message.whatsapp_conversations;
  const contact=Array.isArray(message.whatsapp_contacts)?message.whatsapp_contacts[0]:message.whatsapp_contacts;
  const text=String(message.content||"").slice(0,4096);
  if (!connection.ai_enabled||!connection.automatic_replies_enabled||conversation?.human_controlled) {
    await logEvent(admin,connection,{conversation_id:message.conversation_id,message_id:message.id,event_type:"skipped",success:true,metadata:{reason:conversation?.human_controlled?"human_controlled":"automation_disabled"}}); return;
  }
  let operationStoreId=String(conversation?.selected_store_id||connection.establishment_id);
  if(connection.routing_mode==="organization_selector"&&!conversation?.selected_store_id){
    const {data:stores}=await admin.from("establishments").select("id,name").eq("organization_id",connection.organization_id).eq("unit_status","active").eq("active",true).order("name");
    const normalized=text.toLocaleLowerCase("pt-BR").trim();
    const numbered=/^\d+$/.test(normalized)?Number(normalized)-1:-1;
    const selected=(stores||[]).find((store:Record<string,any>)=>normalized.includes(String(store.name).toLocaleLowerCase("pt-BR")))||(numbered>=0?(stores||[])[numbered]:null);
    if(!selected){
      const options=(stores||[]).map((store:Record<string,any>,index:number)=>`${index+1}. ${store.name}`).join("\n");
      await sendStoredWhatsAppText({admin,establishmentId:connection.establishment_id,connectionId:connection.id,conversationId:message.conversation_id,contactId:message.contact_id,waId:String(contact?.wa_id||""),text:`Olá! Qual unidade você deseja?\n\n${options}`,automationGenerated:true});
      return;
    }
    operationStoreId=String(selected.id);
    await admin.from("whatsapp_conversations").update({selected_store_id:operationStoreId,routing_state:{selection_source:"manual",selected_at:new Date().toISOString()}}).eq("id",message.conversation_id);
    await admin.from("whatsapp_store_selections").upsert({conversation_id:message.conversation_id,organization_id:connection.organization_id,establishment_id:operationStoreId,selection_source:"manual",confirmed_at:new Date().toISOString()},{onConflict:"conversation_id"});
  }
  const {data:featureFlags}=await admin.from("store_feature_flags").select("whatsapp_enabled,ai_enabled").eq("establishment_id",operationStoreId).maybeSingle();
  if(featureFlags&&(featureFlags.whatsapp_enabled===false||featureFlags.ai_enabled===false))return;
  if (!connection.ai_outside_business_hours && !await isWithinBusinessHours(admin,operationStoreId)) {
    await logEvent(admin,connection,{conversation_id:message.conversation_id,message_id:message.id,event_type:"skipped",success:true,metadata:{reason:"outside_business_hours"}}); return;
  }
  const oneMinuteAgo=new Date(Date.now()-60_000).toISOString();
  const {count}=await admin.from("whatsapp_messages").select("id",{count:"exact",head:true}).eq("establishment_id",connection.establishment_id).eq("contact_id",message.contact_id).eq("direction","inbound").gte("message_timestamp",oneMinuteAgo);
  if ((count||0)>connection.ai_rate_limit_per_minute) {
    await admin.rpc("set_whatsapp_waiting_human",{requested_conversation_id:message.conversation_id,requested_intent:"rate_limited"});
    await logEvent(admin,connection,{conversation_id:message.conversation_id,message_id:message.id,event_type:"rate_limited",success:false,error_code:"contact_rate_limit"}); return;
  }
  const {data:recent}=await admin.from("whatsapp_messages").select("direction,content").eq("establishment_id",connection.establishment_id).eq("conversation_id",message.conversation_id).neq("id",message.id).order("message_timestamp",{ascending:false}).limit(6);
  const history=(recent||[]).reverse().map((item:Record<string,any>)=>({role:item.direction==="inbound"?"user":"assistant",content:String(item.content||"").slice(0,600)})) as ConversationTurn[];
  const aiConfig=await loadActiveAIConfig(admin,operationStoreId);
  const effectiveName=aiConfig?.attendant_name||connection.ai_attendant_name;
  const quota=await getAIQuotaState(admin,operationStoreId);
  if(quota.nearLimit){
    const {count:openAlerts}=await admin.from("ai_alerts").select("id",{count:"exact",head:true}).eq("establishment_id",connection.establishment_id).eq("alert_type","quota_warning").is("acknowledged_at",null);
    if(!openAlerts)await admin.from("ai_alerts").insert({establishment_id:connection.establishment_id,alert_type:"quota_warning",severity:quota.exceeded?"critical":"warning",message:quota.exceeded?"O limite mensal da Atendente IA foi atingido.":"O uso mensal da Atendente IA chegou a 80% do limite."});
  }
  if(quota.exceeded&&quota.behavior==="human_handoff"){
    if(connection.human_handoff_enabled)await admin.rpc("set_whatsapp_waiting_human",{requested_conversation_id:message.conversation_id,requested_intent:"ai_quota_reached"});
    const answer=shapeAnswer("O atendimento automático atingiu o limite do plano. Uma pessoa da equipe continuará por aqui.",aiConfig);
    await sendStoredWhatsAppText({admin,establishmentId:connection.establishment_id,connectionId:connection.id,conversationId:message.conversation_id,contactId:message.contact_id,waId:String(contact?.wa_id||""),text:answer,automationGenerated:true});
    await logUsage(admin,connection,{conversation_id:message.conversation_id,event_type:"ai_handoff",config_version_id:aiConfig?.id||null,prompt_base_version:aiConfig?.prompt_base_version||"masterapp-ai-v1",metadata:{reason:"quota_reached"}});return;
  }
  if(aiConfig&&configuredHandoff(text,aiConfig.handoff_rules||{})&&connection.human_handoff_enabled){
    await admin.rpc("set_whatsapp_waiting_human",{requested_conversation_id:message.conversation_id,requested_intent:"configured_handoff"});
    const answer=shapeAnswer("Entendi. Vou transferir sua conversa para uma pessoa da equipe, que continuará o atendimento por aqui.",aiConfig);
    await sendStoredWhatsAppText({admin,establishmentId:connection.establishment_id,connectionId:connection.id,conversationId:message.conversation_id,contactId:message.contact_id,waId:String(contact?.wa_id||""),text:answer,automationGenerated:true});
    await logUsage(admin,connection,{conversation_id:message.conversation_id,event_type:"ai_handoff",latency_ms:Date.now()-started,config_version_id:aiConfig.id,prompt_base_version:aiConfig.prompt_base_version,metadata:{reason:"configured_rule"}});return;
  }
  let orderReply;
  try {
    orderReply=await processConversationalOrder({
      admin,establishmentId:operationStoreId,connectionId:connection.id,
      conversationId:message.conversation_id,contactId:message.contact_id,waId:String(contact?.wa_id||""),
      profileName:String(contact?.name||contact?.profile_name||""),messageId:message.id,text,
    });
  } catch(error) {
    await logEvent(admin,connection,{conversation_id:message.conversation_id,message_id:message.id,event_type:"failed",intent:"ordering",tool_name:"conversationalOrder",success:false,latency_ms:Date.now()-started,error_code:error instanceof Error?error.message.slice(0,80):"ordering_error"});
    orderReply={handled:true,answer:"Não consegui processar essa etapa agora. Seu carrinho foi mantido; tente novamente ou peça atendimento humano.",intent:"ordering",toolName:"conversationalOrder"};
  }
  if(orderReply.handled&&orderReply.answer) {
    const shaped=shapeAnswer(orderReply.answer,aiConfig);
    await sendStoredWhatsAppText({admin,establishmentId:connection.establishment_id,connectionId:connection.id,conversationId:message.conversation_id,contactId:message.contact_id,waId:String(contact?.wa_id||""),text:shaped,automationGenerated:true});
    await admin.from("whatsapp_conversations").update({last_automation_intent:orderReply.intent||"ordering"}).eq("id",message.conversation_id).eq("establishment_id",connection.establishment_id);
    await logEvent(admin,connection,{conversation_id:message.conversation_id,message_id:message.id,event_type:"answered",intent:orderReply.intent||"ordering",tool_name:orderReply.toolName||"conversationalOrder",success:true,latency_ms:Date.now()-started});
    await logUsage(admin,connection,{conversation_id:message.conversation_id,event_type:orderReply.shouldHandoff?"ai_handoff":orderReply.intent==="confirm_order"?"ai_order_created":"ai_message_processed",latency_ms:Date.now()-started,config_version_id:aiConfig?.id||null,prompt_base_version:aiConfig?.prompt_base_version||"masterapp-ai-v1",metadata:{intent:orderReply.intent||"ordering",tool:orderReply.toolName||"conversationalOrder",resolution:orderReply.shouldHandoff?"transferred":"ai_resolved"}});
    return;
  }
  let decision:IntentDecision|null=routeByRules(text);
  try {
    if (!decision&&quota.exceeded&&quota.behavior==="basic_fallback")decision={intent:"unknown",query:"",confidence:0,source:"rule"};
    if (!decision) decision=await getAIProvider().generateResponse({attendantName:effectiveName,history,promptVersion:aiConfig?.prompt_base_version,style:aiConfig?.style,formality:aiConfig?.formality,responseLength:aiConfig?.response_length,emojiLevel:aiConfig?.emoji_level,customTone:aiConfig?.custom_tone,operatingInstructions:aiConfig?.operating_instructions,prohibitedBehaviors:aiConfig?.prohibited_behaviors},text,availableTools);
  } catch(error) {
    await logEvent(admin,connection,{conversation_id:message.conversation_id,message_id:message.id,event_type:"failed",provider:"openai",model:process.env.WHATSAPP_AI_MODEL||"gpt-6-luna",success:false,latency_ms:Date.now()-started,error_code:error instanceof Error?error.message.slice(0,80):"provider_error"});
    decision={intent:"unknown",query:"",confidence:0,source:"ai"};
  }
  if(decision.intent==="unknown"&&aiConfig){
    const knowledge=await findComplementaryKnowledge(admin,operationStoreId,aiConfig.id,text);
    if(knowledge){
      const answer=shapeAnswer(knowledge.answer,aiConfig);
      await sendStoredWhatsAppText({admin,establishmentId:connection.establishment_id,connectionId:connection.id,conversationId:message.conversation_id,contactId:message.contact_id,waId:String(contact?.wa_id||""),text:answer,automationGenerated:true});
      await logUsage(admin,connection,{conversation_id:message.conversation_id,event_type:"ai_message_processed",latency_ms:Date.now()-started,config_version_id:aiConfig.id,prompt_base_version:aiConfig.prompt_base_version,metadata:{intent:"information",tool:knowledge.source,source_id:knowledge.sourceId,resolution:"ai_resolved"}});return;
    }
  }
  if(aiConfig&&decision.confidence<Number(aiConfig.low_confidence_threshold||.65)){
    const topic=normalizedLearningTopic(text);
    const {data:existing}=await admin.from("ai_learning_suggestions").select("id,occurrences").eq("establishment_id",connection.establishment_id).eq("normalized_topic",topic).eq("status","pending").maybeSingle();
    if(existing)await admin.from("ai_learning_suggestions").update({occurrences:Number(existing.occurrences||0)+1,last_seen_at:new Date().toISOString(),sample_question:text.slice(0,500)}).eq("id",existing.id);
    else await admin.from("ai_learning_suggestions").insert({establishment_id:connection.establishment_id,conversation_id:message.conversation_id,normalized_topic:topic,sample_question:text.slice(0,500),reason:"low_confidence"});
    const handoff=aiConfig.unknown_behavior==="handoff"&&connection.human_handoff_enabled;
    if(handoff)await admin.rpc("set_whatsapp_waiting_human",{requested_conversation_id:message.conversation_id,requested_intent:"low_confidence"});
    const answer=shapeAnswer(handoff?"Não tenho segurança para responder corretamente. Vou chamar uma pessoa da equipe.":"Só para confirmar: você pode explicar de outra forma o que precisa?",aiConfig);
    await sendStoredWhatsAppText({admin,establishmentId:connection.establishment_id,connectionId:connection.id,conversationId:message.conversation_id,contactId:message.contact_id,waId:String(contact?.wa_id||""),text:answer,automationGenerated:true});
    await logUsage(admin,connection,{conversation_id:message.conversation_id,event_type:handoff?"ai_handoff":"ai_unknown_question",input_tokens:decision.inputTokens||0,output_tokens:decision.outputTokens||0,latency_ms:Date.now()-started,provider:decision.source==="ai"?"openai":"rules",model:decision.model||null,config_version_id:aiConfig.id,prompt_base_version:aiConfig.prompt_base_version,metadata:{confidence:decision.confidence,topic}});return;
  }
  await logEvent(admin,connection,{conversation_id:message.conversation_id,message_id:message.id,event_type:"classified",intent:decision.intent,provider:decision.source==="ai"?"openai":"rules",model:decision.source==="ai"?(process.env.WHATSAPP_AI_MODEL||"gpt-6-luna"):null,success:true,latency_ms:Date.now()-started,metadata:{confidence:decision.confidence}});
  const result=await executeMasterAppTool(decision.intent,{admin,establishmentId:operationStoreId,waId:String(contact?.wa_id||""),query:decision.query,attendantName:effectiveName,humanHandoffEnabled:connection.human_handoff_enabled});
  await logEvent(admin,connection,{conversation_id:message.conversation_id,message_id:message.id,event_type:"tool_called",intent:decision.intent,tool_name:result.toolName,success:result.ok,latency_ms:Date.now()-started});
  const mustHandoff=Boolean(result.shouldHandoff&&connection.human_handoff_enabled);
  if (mustHandoff) await admin.rpc("set_whatsapp_waiting_human",{requested_conversation_id:message.conversation_id,requested_intent:decision.intent});
  const answer=shapeAnswer(decision.intent==="greeting"?(aiConfig?.introduction||connection.ai_welcome_message):(decision.intent==="unknown"?(aiConfig?.fallback_message||connection.ai_fallback_message):result.answer),aiConfig);
  await sendStoredWhatsAppText({admin,establishmentId:connection.establishment_id,connectionId:connection.id,conversationId:message.conversation_id,contactId:message.contact_id,waId:String(contact?.wa_id||""),text:answer,automationGenerated:true});
  await admin.from("whatsapp_conversations").update({last_automation_intent:decision.intent}).eq("id",message.conversation_id).eq("establishment_id",connection.establishment_id);
  await logEvent(admin,connection,{conversation_id:message.conversation_id,message_id:message.id,event_type:mustHandoff?"human_handoff":"answered",intent:decision.intent,tool_name:result.toolName,success:true,latency_ms:Date.now()-started});
  await logUsage(admin,connection,{conversation_id:message.conversation_id,event_type:mustHandoff?"ai_handoff":decision.intent==="unknown"?"ai_fallback":"ai_message_processed",provider:decision.source==="ai"?"openai":"rules",model:decision.model||null,input_tokens:decision.inputTokens||0,output_tokens:decision.outputTokens||0,latency_ms:Date.now()-started,config_version_id:aiConfig?.id||null,prompt_base_version:aiConfig?.prompt_base_version||"masterapp-ai-v1",metadata:{intent:decision.intent,tool:result.toolName,confidence:decision.confidence,resolution:mustHandoff?"transferred":decision.intent==="unknown"?"unresolved":"ai_resolved"}});
}

