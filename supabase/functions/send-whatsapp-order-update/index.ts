import { createClient } from "npm:@supabase/supabase-js@2.110.8";

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async(request:Request)=>{
  if(request.method!=="POST") return new Response("Method not allowed",{status:405});
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let eventId="";
  try {
    const payload=await request.json() as {event_id?:string;token?:string};
    eventId=String(payload.event_id||""); const token=String(payload.token||"");
    if(!uuid.test(eventId)||!uuid.test(token)) return new Response("Invalid event",{status:400});
    const {data:event}=await admin.from("whatsapp_order_notification_outbox").select("*").eq("id",eventId).eq("delivery_token",token).maybeSingle();
    if(!event) return new Response("Not found",{status:404});
    if(event.status==="sent") return Response.json({ok:true,duplicate:true});
    const {data:claimed}=await admin.from("whatsapp_order_notification_outbox").update({status:"processing",attempts:event.attempts+1,error_message:null}).eq("id",eventId).in("status",["pending","failed"]).select("id").maybeSingle();
    if(!claimed) return Response.json({ok:true,duplicate:true});
    const {data:connection}=await admin.from("whatsapp_connections").select("phone_number_id,graph_api_version,status").eq("id",event.connection_id).eq("establishment_id",event.establishment_id).eq("status","connected").single();
    const {data:secret}=await admin.rpc("get_whatsapp_connection_secret",{requested_connection_id:event.connection_id});
    if(!connection||!secret?.access_token) throw new Error("Conexão do WhatsApp indisponível.");
    const response=await fetch(`https://graph.facebook.com/${connection.graph_api_version||"v23.0"}/${connection.phone_number_id}/messages`,{method:"POST",headers:{Authorization:`Bearer ${secret.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",recipient_type:"individual",to:event.wa_id,type:"text",text:{preview_url:false,body:event.message_text}})});
    const result=await response.json() as {messages?:Array<{id:string}>;error?:{message?:string}};
    if(!response.ok||!result.messages?.[0]?.id) throw new Error(result.error?.message||`Meta ${response.status}`);
    const now=new Date().toISOString();
    const {data:message}=await admin.from("whatsapp_messages").insert({establishment_id:event.establishment_id,conversation_id:event.conversation_id,contact_id:event.contact_id,whatsapp_message_id:result.messages[0].id,direction:"outbound",message_type:"text",content:event.message_text,status:"sent",automation_generated:true,message_timestamp:now}).select("id").single();
    await Promise.all([
      admin.from("whatsapp_order_notification_outbox").update({status:"sent",sent_at:now,error_message:null}).eq("id",eventId),
      admin.from("whatsapp_conversations").update({last_message_id:message?.id,last_message_preview:event.message_text.slice(0,180),last_message_at:now,last_ai_response_at:now}).eq("id",event.conversation_id).eq("establishment_id",event.establishment_id),
    ]);
    return Response.json({ok:true});
  } catch(error) {
    if(eventId&&uuid.test(eventId)) await admin.from("whatsapp_order_notification_outbox").update({status:"failed",error_message:(error instanceof Error?error.message:"Falha no envio").slice(0,500)}).eq("id",eventId);
    console.error(error);
    return new Response("Delivery failed",{status:500});
  }
});
