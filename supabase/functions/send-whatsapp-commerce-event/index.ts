import { createClient } from "npm:@supabase/supabase-js@2.110.8";

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async(request:Request)=>{
  if(request.method!=="POST") return new Response("Method not allowed",{status:405});
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let eventId=""; let attempt=0;
  try {
    const payload=await request.json() as {event_id?:string;token?:string};
    eventId=String(payload.event_id||""); const token=String(payload.token||"");
    if(!uuid.test(eventId)||!uuid.test(token)) return new Response("Invalid event",{status:400});
    const {data:event}=await admin.from("whatsapp_commerce_outbox").select("*").eq("id",eventId).eq("delivery_token",token).maybeSingle();
    if(!event) return new Response("Not found",{status:404});
    if(["sent","skipped"].includes(event.status)) return Response.json({ok:true,duplicate:true});
    if(event.attempts>=3) return Response.json({ok:false,exhausted:true},{status:409});
    attempt=event.attempts+1;
    const {data:claimed}=await admin.from("whatsapp_commerce_outbox").update({status:"processing",attempts:attempt,error_message:null,updated_at:new Date().toISOString()}).eq("id",eventId).in("status",["pending","failed"]).lt("attempts",3).select("id").maybeSingle();
    if(!claimed) return Response.json({ok:true,duplicate:true});

    const {data:lastInbound}=await admin.from("whatsapp_messages").select("message_timestamp").eq("conversation_id",event.conversation_id).eq("direction","inbound").order("message_timestamp",{ascending:false}).limit(1).maybeSingle();
    if(!lastInbound||Date.now()-new Date(lastInbound.message_timestamp).getTime()>24*60*60*1000) {
      await admin.from("whatsapp_commerce_outbox").update({status:"skipped",error_message:"Fora da janela de 24 horas da Meta; template aprovado necessário.",updated_at:new Date().toISOString()}).eq("id",eventId);
      return Response.json({ok:true,skipped:true});
    }
    const [{data:contact},{data:conversation},{data:connection},{data:secret}]=await Promise.all([
      admin.from("whatsapp_contacts").select("marketing_opt_out,blocked_at").eq("id",event.contact_id).eq("establishment_id",event.establishment_id).single(),
      admin.from("whatsapp_conversations").select("human_controlled,status").eq("id",event.conversation_id).eq("establishment_id",event.establishment_id).single(),
      admin.from("whatsapp_connections").select("phone_number_id,graph_api_version,status").eq("id",event.connection_id).eq("establishment_id",event.establishment_id).eq("status","connected").single(),
      admin.rpc("get_whatsapp_connection_secret",{requested_connection_id:event.connection_id}),
    ]);
    if(contact?.blocked_at||(event.event_type==="cart_recovery"&&contact?.marketing_opt_out)||conversation?.human_controlled||conversation?.status==="resolved") {
      await admin.from("whatsapp_commerce_outbox").update({status:"skipped",error_message:"Automação bloqueada pelo contato ou atendimento humano.",updated_at:new Date().toISOString()}).eq("id",eventId);
      return Response.json({ok:true,skipped:true});
    }
    if(!connection||!secret?.access_token) throw new Error("Conexão do WhatsApp indisponível.");
    const response=await fetch(`https://graph.facebook.com/${connection.graph_api_version||"v23.0"}/${connection.phone_number_id}/messages`,{method:"POST",headers:{Authorization:`Bearer ${secret.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",recipient_type:"individual",to:event.wa_id,type:"text",text:{preview_url:false,body:event.message_text}})});
    const result=await response.json() as {messages?:Array<{id:string}>;error?:{message?:string}};
    if(!response.ok||!result.messages?.[0]?.id) throw new Error(result.error?.message||`Meta ${response.status}`);
    const now=new Date().toISOString();
    const {data:message}=await admin.from("whatsapp_messages").insert({establishment_id:event.establishment_id,conversation_id:event.conversation_id,contact_id:event.contact_id,whatsapp_message_id:result.messages[0].id,direction:"outbound",message_type:"text",content:event.message_text,status:"sent",automation_generated:true,message_timestamp:now}).select("id").single();
    await Promise.all([
      admin.from("whatsapp_commerce_outbox").update({status:"sent",sent_at:now,error_message:null,updated_at:now}).eq("id",eventId),
      admin.from("whatsapp_conversations").update({last_message_id:message?.id,last_message_preview:event.message_text.slice(0,180),last_message_at:now,last_ai_response_at:now}).eq("id",event.conversation_id).eq("establishment_id",event.establishment_id),
    ]);
    return Response.json({ok:true});
  } catch(error) {
    if(eventId&&uuid.test(eventId)) {
      const delayMinutes=Math.min(30,2**Math.max(0,attempt-1));
      await admin.from("whatsapp_commerce_outbox").update({status:"failed",error_message:(error instanceof Error?error.message:"Falha no envio").slice(0,500),next_attempt_at:new Date(Date.now()+delayMinutes*60_000).toISOString(),updated_at:new Date().toISOString()}).eq("id",eventId);
    }
    console.error(error);
    return new Response("Delivery failed",{status:500});
  }
});
