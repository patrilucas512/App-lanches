import {NextResponse} from "next/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {getVoiceProvider} from "@/lib/voice/provider";
import {processVoiceEvent} from "@/lib/voice/orchestrator";

export async function POST(request:Request){
  const rawBody=await request.text();
  let payload:unknown;
  try{payload=JSON.parse(rawBody);}catch{return NextResponse.json({error:"Payload inválido."},{status:400});}
  const providerKey=request.headers.get("x-masterapp-voice-provider")||"generic";
  const secret=process.env.VOICE_WEBHOOK_SECRET||"";
  const provider=getVoiceProvider(providerKey);
  if(!provider.verifyWebhook(rawBody,request.headers.get("x-masterapp-signature"),secret))return NextResponse.json({error:"Assinatura inválida."},{status:401});
  try{
    const event=provider.parseEvent(payload);
    if(event.provider!==providerKey)return NextResponse.json({error:"Provider divergente."},{status:400});
    const result=await processVoiceEvent(createAdminClient(),event);
    return NextResponse.json(provider.formatActions(result.actions),{headers:{"x-masterapp-call-session":result.callSessionId}});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"Falha temporária no atendimento de voz."},{status:500});
  }
}
