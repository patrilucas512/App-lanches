import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeText } from "./intent-router";

export type AIConfig = {
  id:string; version:number; attendant_name:string; introduction:string; style:string; formality:number;
  response_length:string; emoji_level:string; custom_tone:string; fallback_message:string;
  operating_instructions:string; prohibited_behaviors:string[]; handoff_rules:Record<string,boolean>;
  automation_schedule:Record<string,unknown>; low_confidence_threshold:number; unknown_behavior:string; prompt_base_version:string;
  inherit_organization_defaults?:boolean;
};

export async function loadActiveAIConfig(admin:SupabaseClient,establishmentId:string):Promise<AIConfig|null> {
  const {data:storeConfig}=await admin.from("ai_config_versions").select("*").eq("establishment_id",establishmentId).eq("status","published").maybeSingle();
  if(storeConfig && !storeConfig.inherit_organization_defaults)return storeConfig as AIConfig;
  const {data:store}=await admin.from("establishments").select("organization_id").eq("id",establishmentId).maybeSingle();
  if(!store?.organization_id)return storeConfig as AIConfig|null;
  const {data:settings}=await admin.from("organization_ai_settings").select("default_config_version_id,allow_store_override").eq("organization_id",store.organization_id).maybeSingle();
  if(storeConfig && settings?.allow_store_override!==false && !storeConfig.inherit_organization_defaults)return storeConfig as AIConfig;
  if(settings?.default_config_version_id){
    const {data:organizationConfig}=await admin.from("ai_config_versions").select("*").eq("id",settings.default_config_version_id).eq("status","published").maybeSingle();
    if(organizationConfig)return organizationConfig as AIConfig;
  }
  return storeConfig as AIConfig|null;
}

function words(value:string){return new Set(normalizeText(value).split(/\s+/).filter(word=>word.length>2));}
function score(query:string,candidate:string){const q=words(query),c=words(candidate);if(!q.size)return 0;let hits=0;q.forEach(word=>{if(c.has(word))hits+=1});return hits/q.size;}

export async function findComplementaryKnowledge(admin:SupabaseClient,establishmentId:string,configId:string,message:string) {
  const {data:store}=await admin.from("establishments").select("organization_id").eq("id",establishmentId).maybeSingle();
  const [{data:faqs},{data:knowledge}]=await Promise.all([
    admin.from("ai_faqs").select("id,question,answer,variations,category,scope,establishment_id").eq("organization_id",store?.organization_id).eq("status","active").limit(300),
    admin.from("ai_knowledge_items").select("id,title,content,category,scope,establishment_id").eq("organization_id",store?.organization_id).eq("status","active").limit(300),
  ]);
  const eligible=(item:Record<string,any>)=>item.scope==="organization"||item.establishment_id===establishmentId;
  const priority=(item:Record<string,any>)=>item.scope==="store"&&item.establishment_id===establishmentId ? .12 : 0;
  const faqMatches=(faqs||[]).filter(eligible).map((item:Record<string,any>)=>({...item,score:score(message,[item.question,...(item.variations||[])].join(" "))+priority(item)})).sort((a:Record<string,any>,b:Record<string,any>)=>b.score-a.score);
  if(faqMatches[0]?.score>=.45)return {answer:String(faqMatches[0].answer),source:"faq",sourceId:String(faqMatches[0].id),confidence:Math.min(.94,faqMatches[0].score)};
  const knowledgeMatches=(knowledge||[]).filter(eligible).map((item:Record<string,any>)=>({...item,score:score(message,`${item.title} ${item.content}`)+priority(item)})).sort((a:Record<string,any>,b:Record<string,any>)=>b.score-a.score);
  if(knowledgeMatches[0]?.score>=.5)return {answer:String(knowledgeMatches[0].content),source:"knowledge",sourceId:String(knowledgeMatches[0].id),confidence:Math.min(.9,knowledgeMatches[0].score)};
  return null;
}

export function shapeAnswer(answer:string,config:AIConfig|null){
  if(!config)return answer;
  let value=answer.trim();
  if(config.response_length==="short"&&value.length>650)value=`${value.slice(0,647).trimEnd()}…`;
  if(config.emoji_level==="none")value=value.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu,"").replace(/ {2,}/g," ").trim();
  return value;
}

export function normalizedLearningTopic(message:string){return normalizeText(message).replace(/[^a-z0-9 ]/g,"").split(" ").filter(word=>word.length>2).slice(0,8).sort().join(" ").slice(0,160)||"pergunta-desconhecida";}

export async function getAIQuotaState(admin:SupabaseClient,establishmentId:string){
  const {data:subscription}=await admin.from("subscriptions").select("plan_id").eq("establishment_id",establishmentId).in("status",["active","trialing"]).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(!subscription?.plan_id)return {exceeded:false,nearLimit:false,behavior:"human_handoff"};
  const {data:limits}=await admin.from("ai_plan_entitlements").select("ai_enabled,max_ai_conversations_month,max_ai_messages_month,quota_behavior").eq("plan_id",subscription.plan_id).maybeSingle();
  if(!limits||limits.ai_enabled===false)return {exceeded:true,nearLimit:true,behavior:String(limits?.quota_behavior||"human_handoff")};
  const monthStart=new Date();monthStart.setUTCDate(1);monthStart.setUTCHours(0,0,0,0);
  const [{count:messages},{data:rows}]=await Promise.all([
    admin.from("ai_usage_events").select("id",{count:"exact",head:true}).eq("establishment_id",establishmentId).eq("event_type","ai_message_processed").gte("created_at",monthStart.toISOString()),
    admin.from("ai_usage_events").select("conversation_id").eq("establishment_id",establishmentId).not("conversation_id","is",null).gte("created_at",monthStart.toISOString()).limit(50000),
  ]);
  const conversations=new Set((rows||[]).map((row:Record<string,unknown>)=>String(row.conversation_id))).size;
  const maxMessages=Number(limits.max_ai_messages_month||0),maxConversations=Number(limits.max_ai_conversations_month||0);
  const ratios=[maxMessages?Number(messages||0)/maxMessages:0,maxConversations?conversations/maxConversations:0];const ratio=Math.max(...ratios);
  return {exceeded:ratio>=1,nearLimit:ratio>=.8,behavior:String(limits.quota_behavior||"human_handoff"),ratio,messages:messages||0,conversations};
}
