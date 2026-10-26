import type {SupabaseClient} from "@supabase/supabase-js";
import {processConversationalOrder} from "@/lib/ai-attendant/order-conversation";
import {executeMasterAppTool} from "@/lib/ai-attendant/masterapp-tools";
import {routeByRules} from "@/lib/ai-attendant/intent-router";
import {isCardDisclosure,isEmergency,normalizePhone,redactSensitiveSpeech,shortVoiceResponse,validSpeechConfidence} from "./speech";
import type {VoiceAction,VoiceEvent,VoiceWebhookResult} from "./types";
import {recordVoiceTurn} from "@/lib/omnichannel/engine";

type Connection={id:string;establishment_id:string;organization_id:string|null;provider:string;attendant_name:string;voice_name:string;language:string;speech_speed:number;welcome_message:string;personalize_recognized_customers:boolean;human_fallback_enabled:boolean;transfer_destination:string|null;recording_enabled:boolean;transcript_enabled:boolean;max_concurrent_calls:number;resume_window_minutes:number};
const speak=(connection:Connection,text:string):VoiceAction=>({type:"speak",text:shortVoiceResponse(text),bargeIn:true,language:connection.language,voice:connection.voice_name,speed:Number(connection.speech_speed)});

async function recordEvent(admin:SupabaseClient,connection:Connection,callId:string,event:VoiceEvent,from:string|null,to:string|null,metadata:Record<string,unknown>={}){
  const {error}=await admin.from("voice_call_events").insert({establishment_id:connection.establishment_id,call_session_id:callId,provider_event_id:event.id,event_type:event.type,state_from:from,state_to:to,confidence:event.confidence??null,metadata});
  return !error;
}

async function handoff(admin:SupabaseClient,connection:Connection,callId:string,reason:string):Promise<VoiceAction[]>{
  const {data:queue}=await admin.from("support_queues").select("id").eq("organization_id",connection.organization_id).or(`store_id.eq.${connection.establishment_id},store_id.is.null`).eq("status","active").order("priority").limit(1).maybeSingle();
  await admin.from("voice_call_sessions").update({state:"human_transfer",human_transferred:true,queue_id:queue?.id||null,summary:reason,updated_at:new Date().toISOString()}).eq("id",callId).eq("establishment_id",connection.establishment_id);
  if(connection.transfer_destination)return [speak(connection,"Vou transferir sua ligação para uma pessoa da equipe. Aguarde um instante."),{type:"transfer",destination:connection.transfer_destination,summary:reason}];
  return [{type:"hold",message:"Todos os atendentes estão ocupados. Você pode aguardar ou solicitar retorno."},speak(connection,"Nossa equipe está ocupada. Posso registrar uma solicitação de retorno.")];
}

export async function processVoiceEvent(admin:SupabaseClient,event:VoiceEvent):Promise<VoiceWebhookResult>{
  const {data:connection,error:connectionError}=await admin.from("voice_connections").select("*").eq("provider_connection_id",event.providerConnectionId).eq("provider",event.provider).eq("active",true).eq("status","connected").maybeSingle();
  if(connectionError||!connection)throw new Error("Conexão telefônica ativa não encontrada.");
  const config=connection as Connection; const phone=normalizePhone(event.from);
  const [{data:flags},{data:subscription}]=await Promise.all([
    admin.from("store_feature_flags").select("voice_ai_enabled,voice_ordering_enabled,voice_human_transfer_enabled").eq("establishment_id",config.establishment_id).maybeSingle(),
    admin.from("subscriptions").select("plans(voice_ai_enabled,voice_ordering_enabled,voice_human_transfer_enabled,max_concurrent_calls)").eq("establishment_id",config.establishment_id).in("status",["active","trialing"]).order("created_at",{ascending:false}).limit(1).maybeSingle(),
  ]);
  const plan=Array.isArray(subscription?.plans)?subscription.plans[0]:subscription?.plans;
  if(plan&&(!plan.voice_ai_enabled||flags?.voice_ai_enabled===false))throw new Error("Atendimento telefônico indisponível no plano ou unidade.");
  config.max_concurrent_calls=Math.min(config.max_concurrent_calls,Number(plan?.max_concurrent_calls||config.max_concurrent_calls));
  const {data:blocked}=await admin.from("voice_blocklist").select("id").eq("establishment_id",config.establishment_id).eq("normalized_phone",phone).eq("active",true).maybeSingle();
  if(blocked)return {callSessionId:"blocked",actions:[{type:"end"}]};

  let {data:session}=await admin.from("voice_call_sessions").select("*").eq("connection_id",config.id).eq("provider_call_id",event.providerCallId).maybeSingle();
  if(!session&&event.type!=="incoming_call")throw new Error("Sessão telefônica não encontrada.");
  if(!session){
    const {count}=await admin.from("voice_call_sessions").select("id",{count:"exact",head:true}).eq("connection_id",config.id).in("state",["queued","greeting","intent_detection","ordering","collecting_address","payment","confirmation","status_lookup","human_transfer","on_hold"]);
    const {data:customer}=await admin.from("customers").select("id,name").eq("establishment_id",config.establishment_id).eq("phone",phone).maybeSingle();
    const exceeded=Number(count||0)>=config.max_concurrent_calls;
    const {data:created,error}=await admin.from("voice_call_sessions").insert({organization_id:config.organization_id,establishment_id:config.establishment_id,connection_id:config.id,provider_call_id:event.providerCallId,customer_id:customer?.id||null,source_phone:phone,customer_name:customer?.name||null,state:exceeded?"queued":"greeting",recording_enabled:config.recording_enabled,transcript_enabled:config.transcript_enabled,continuation_expires_at:new Date(Date.now()+config.resume_window_minutes*60000).toISOString(),metadata:{recognized:Boolean(customer)}}).select("*").single();
    if(error)throw error; session=created;
    await recordEvent(admin,config,session.id,event,null,session.state,{concurrency_exceeded:exceeded});
    if(exceeded)return {callSessionId:session.id,actions:[{type:"answer"},{type:"hold",message:"Sua ligação entrou na fila. Aguarde ou solicite retorno."}]};
    const name=config.personalize_recognized_customers&&customer?.name?`, ${String(customer.name).split(" ")[0]}`:"";
    return {callSessionId:session.id,actions:[{type:"answer"},speak(config,`${config.welcome_message}${name}`)]};
  }

  const inserted=await recordEvent(admin,config,session.id,event,session.state,session.state);
  if(!inserted)return {callSessionId:session.id,actions:[],idempotent:true};
  if(event.type==="barge_in")return {callSessionId:session.id,actions:[{type:"stop_audio"}]};
  if(event.type==="provider_unavailable")return {callSessionId:session.id,actions:await handoff(admin,config,session.id,"Instabilidade do provider de voz.")};
  if(event.type==="call_ended"){
    await admin.from("voice_call_sessions").update({state:session.result?"completed":"abandoned",result:session.result||"abandoned",ended_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",session.id).eq("establishment_id",config.establishment_id);
    await admin.from("voice_cost_usage").insert({establishment_id:config.establishment_id,call_session_id:session.id,provider:event.provider,telephony_seconds:Math.max(0,event.durationSeconds||0)});
    return {callSessionId:session.id,actions:[]};
  }
  const raw=String(event.transcript||"").trim(); const redacted=redactSensitiveSpeech(raw);
  if(config.transcript_enabled&&raw)await admin.from("voice_transcript_segments").insert({establishment_id:config.establishment_id,call_session_id:session.id,speaker:"customer",redacted_text:redacted.text,confidence:event.confidence??null,sensitive_content_detected:redacted.detected});
  if(raw){try{await recordVoiceTurn(admin,{establishmentId:config.establishment_id,callId:session.id,eventId:event.id,text:redacted.text,customerId:session.customer_id,eventType:event.type,confidence:event.confidence,speaker:"customer"});}catch{/* Voice processing must continue if the omnichannel projection is delayed. */}}
  if(!validSpeechConfidence(event.confidence))return {callSessionId:session.id,actions:[speak(config,"Não entendi com segurança. Pode repetir mais devagar?")]};
  if(isEmergency(raw))return {callSessionId:session.id,actions:[speak(config,"Este canal não é um serviço de emergência. Procure agora o serviço de emergência adequado da sua região."),{type:"end"}]};
  if(isCardDisclosure(raw))return {callSessionId:session.id,actions:[speak(config,"Por segurança, não informe número, validade ou código do cartão pela ligação. Posso enviar um link seguro para pagamento.")]};
  if(/\b(atendente|humano|pessoa|gerente|reclamacao|reembolso)\b/i.test(raw))return plan?.voice_human_transfer_enabled===false||flags?.voice_human_transfer_enabled===false?{callSessionId:session.id,actions:[speak(config,"A transferência telefônica não está disponível neste plano. Posso registrar uma solicitação de retorno.")]}:{callSessionId:session.id,actions:await handoff(admin,config,session.id,`Cliente solicitou atendimento humano: ${redacted.text.slice(0,180)}`)};

  const orderingAllowed=plan?.voice_ordering_enabled!==false&&flags?.voice_ordering_enabled!==false;
  const order=orderingAllowed?await processConversationalOrder({admin,establishmentId:config.establishment_id,channel:"voice",voiceCallId:session.id,customerId:session.customer_id,customerPhone:phone,customerName:session.customer_name||"Cliente por telefone",messageId:event.id,text:raw}):{handled:false};
  if(order.handled){
    await admin.from("voice_call_sessions").update({state:order.intent==="confirm_order"?"confirmation":"ordering",last_intent:order.intent||"ordering",last_confidence:event.confidence??null,updated_at:new Date().toISOString()}).eq("id",session.id);
    return {callSessionId:session.id,actions:[speak(config,String(order.answer||"Certo."))]};
  }
  const decision=routeByRules(raw);
  if(decision){
    if(decision.intent==="human_handoff")return {callSessionId:session.id,actions:await handoff(admin,config,session.id,"Transferência solicitada pelo cliente.")};
    const tool=await executeMasterAppTool(decision.intent,{admin,establishmentId:config.establishment_id,waId:phone,query:decision.query,attendantName:config.attendant_name,humanHandoffEnabled:config.human_fallback_enabled});
    if(tool.shouldHandoff)return {callSessionId:session.id,actions:await handoff(admin,config,session.id,tool.answer)};
    return {callSessionId:session.id,actions:[speak(config,tool.answer)]};
  }
  return config.human_fallback_enabled?{callSessionId:session.id,actions:await handoff(admin,config,session.id,"A IA não identificou a solicitação com segurança.")}:{callSessionId:session.id,actions:[speak(config,"Não consegui entender. Pode explicar de outra forma?")]};
}

