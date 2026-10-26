import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { routeByRules } from "@/lib/ai-attendant/intent-router";
import { availableTools, executeMasterAppTool } from "@/lib/ai-attendant/masterapp-tools";
import { getAIProvider } from "@/lib/ai-attendant/providers";
import { findComplementaryKnowledge, loadActiveAIConfig, shapeAnswer } from "@/lib/ai-attendant/config";

export async function POST(request:Request){
  try{
    const body=await request.json() as {establishment_id?:string;message?:string;config_id?:string};
    const establishmentId=String(body.establishment_id||"");const message=String(body.message||"").trim().slice(0,2000);
    if(!/^[0-9a-f-]{36}$/i.test(establishmentId)||!message)return NextResponse.json({error:"Mensagem inválida."},{status:400});
    const supabase=await createClient();const {data:claims}=await (supabase.auth as any).getClaims();const userId=claims?.claims?.sub;
    if(!userId)return NextResponse.json({error:"Sessão expirada."},{status:401});
    const [{data:member},{data:permission}]=await Promise.all([
      supabase.from("establishment_members").select("role").eq("establishment_id",establishmentId).eq("user_id",userId).maybeSingle(),
      supabase.from("ai_member_permissions").select("can_use_simulator").eq("establishment_id",establishmentId).eq("user_id",userId).maybeSingle(),
    ]);
    if(!member||(!["owner","manager"].includes(member.role)&&!permission?.can_use_simulator))return NextResponse.json({error:"Sem permissão para usar o simulador."},{status:403});
    const admin=createAdminClient();let config=await loadActiveAIConfig(admin,establishmentId);
    if(body.config_id){const {data}=await admin.from("ai_config_versions").select("*").eq("id",body.config_id).eq("establishment_id",establishmentId).maybeSingle();if(data)config=data as typeof config;}
    if(!config)return NextResponse.json({error:"Crie uma configuração da atendente primeiro."},{status:409});
    const started=Date.now();let decision=routeByRules(message);
    if(!decision)decision=await getAIProvider().generateResponse({attendantName:config.attendant_name,history:[],promptVersion:config.prompt_base_version,style:config.style,formality:config.formality,responseLength:config.response_length,emojiLevel:config.emoji_level,customTone:config.custom_tone,operatingInstructions:config.operating_instructions,prohibitedBehaviors:config.prohibited_behaviors},message,availableTools);
    let answer="";let tool="none";let source="structured";
    if(decision.intent==="unknown"){
      const knowledge=await findComplementaryKnowledge(admin,establishmentId,config.id,message);
      if(knowledge){answer=knowledge.answer;tool=knowledge.source;source="complementary_knowledge";}
      else {answer=config.fallback_message;tool="fallback";source="fallback";}
    }else{
      const result=await executeMasterAppTool(decision.intent,{admin,establishmentId,waId:"simulation",query:decision.query,attendantName:config.attendant_name,humanHandoffEnabled:true});
      answer=decision.intent==="greeting"?config.introduction:result.answer;tool=result.toolName;
    }
    await admin.from("ai_usage_events").insert({establishment_id:establishmentId,event_type:"ai_simulation",provider:decision.source==="ai"?"openai":"rules",model:decision.model||null,input_tokens:decision.inputTokens||0,output_tokens:decision.outputTokens||0,latency_ms:Date.now()-started,config_version_id:config.id,prompt_base_version:config.prompt_base_version,metadata:{intent:decision.intent,tool,source,sandbox:true}});
    return NextResponse.json({answer:shapeAnswer(answer,config),technical:{intent:decision.intent,confidence:decision.confidence,tool,source,config_version:`v${config.version}`,sandbox:true,writes_performed:0}});
  }catch{return NextResponse.json({error:"Não foi possível executar a simulação agora."},{status:500});}
}
