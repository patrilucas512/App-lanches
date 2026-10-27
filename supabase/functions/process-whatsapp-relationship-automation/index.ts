import { createClient } from "npm:@supabase/supabase-js@2.110.8";
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async(request:Request)=>{
  if(request.method!=="POST") return new Response("Method not allowed",{status:405});
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let eventId=""; let attempts=0;
  try {
    const payload=await request.json() as {event_id?:string;token?:string}; eventId=String(payload.event_id||""); const token=String(payload.token||"");
    if(!uuid.test(eventId)||!uuid.test(token)) return new Response("Invalid event",{status:400});
    const {data:event}=await admin.from("crm_relationship_outbox").select("*,crm_automations(template_id),customers(name,marketing_status),whatsapp_contacts(wa_id,marketing_opt_out,blocked_at),orders(order_number),establishments(name,slug)").eq("id",eventId).eq("delivery_token",token).maybeSingle();
    if(!event) return new Response("Not found",{status:404}); if(["sent","skipped"].includes(event.status)) return Response.json({ok:true,duplicate:true});
    attempts=Number(event.attempts||0)+1;
    const {data:claimed}=await admin.from("crm_relationship_outbox").update({status:"processing",attempts,updated_at:new Date().toISOString()}).eq("id",eventId).in("status",["pending","failed"]).lt("attempts",3).select("id").maybeSingle();
    if(!claimed)return Response.json({ok:true,duplicate:true});
    const contact=Array.isArray(event.whatsapp_contacts)?event.whatsapp_contacts[0]:event.whatsapp_contacts; const customer=Array.isArray(event.customers)?event.customers[0]:event.customers;
    const promotional=["repurchase","inactive","vip"].includes(event.automation_type);
    if(contact?.blocked_at||contact?.marketing_opt_out||(promotional&&customer?.marketing_status!=="opted_in")) {await admin.from("crm_relationship_outbox").update({status:"skipped",error_message:"Consentimento ausente, opt-out ou bloqueio.",updated_at:new Date().toISOString()}).eq("id",eventId);return Response.json({ok:true,skipped:true});}
    const automation=Array.isArray(event.crm_automations)?event.crm_automations[0]:event.crm_automations;
    const [{data:template},{data:connection}]=await Promise.all([
      admin.from("whatsapp_message_templates").select("name,language,status,variables,body").eq("id",automation.template_id).eq("establishment_id",event.establishment_id).single(),
      admin.from("whatsapp_connections").select("id,phone_number_id,graph_api_version").eq("establishment_id",event.establishment_id).eq("status","connected").single(),
    ]);
    if(template.status!=="approved") throw new Error("Template não aprovado."); const {data:secret}=await admin.rpc("get_whatsapp_connection_secret",{requested_connection_id:connection.id});
    const vars:Record<string,string>={nome_cliente:customer?.name||"Cliente",nome_loja:event.establishments?.name||"nossa loja",numero_pedido:event.orders?.order_number?String(event.orders.order_number):"",link_cardapio:`${Deno.env.get("PUBLIC_SITE_URL")||""}/loja/${event.establishments?.slug||""}`};
    const keys=Array.isArray(template.variables)?template.variables:[]; if(keys.some((key:string)=>!vars[key])) throw new Error("Variável obrigatória ausente.");
    const components=keys.length?[{type:"body",parameters:keys.map((key:string)=>({type:"text",text:vars[key]}))}]:undefined;
    const response=await fetch(`https://graph.facebook.com/${connection.graph_api_version||"v23.0"}/${connection.phone_number_id}/messages`,{method:"POST",headers:{Authorization:`Bearer ${secret.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",to:contact.wa_id,type:"template",template:{name:template.name,language:{code:template.language},components}})});
    const result=await response.json() as {messages?:Array<{id:string}>;error?:{message?:string}}; if(!response.ok||!result.messages?.[0]?.id)throw new Error(result.error?.message||`Meta ${response.status}`);
    await admin.from("crm_relationship_outbox").update({status:"sent",whatsapp_message_id:result.messages[0].id,sent_at:new Date().toISOString(),error_message:null,updated_at:new Date().toISOString()}).eq("id",eventId);
    return Response.json({ok:true});
  } catch(error) {
    if(eventId&&uuid.test(eventId))await admin.from("crm_relationship_outbox").update({status:"failed",error_message:(error instanceof Error?error.message:"Falha").slice(0,500),next_attempt_at:new Date(Date.now()+Math.min(60,2**attempts)*60_000).toISOString(),updated_at:new Date().toISOString()}).eq("id",eventId);
    return Response.json({error:error instanceof Error?error.message:"Falha"},{status:500});
  }
});
