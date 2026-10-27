import { createClient } from "npm:@supabase/supabase-js@2.110.8";

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fill=(value:string,vars:Record<string,string>)=>value.replace(/{{\s*([a-z_]+)\s*}}/gi,(_,key)=>vars[key]||"Cliente");

Deno.serve(async(request:Request)=>{
  if(request.method!=="POST") return new Response("Method not allowed",{status:405});
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const payload=await request.json() as {campaign_id?:string;token?:string};
    const campaignId=String(payload.campaign_id||""); const token=String(payload.token||"");
    if(!uuid.test(campaignId)||!uuid.test(token)) return new Response("Invalid campaign",{status:400});
    const {data:campaign}=await admin.from("crm_campaigns").select("*,whatsapp_message_templates(name,language,status,body,variables),establishments(name,slug),coupons(code)").eq("id",campaignId).eq("dispatch_token",token).maybeSingle();
    if(!campaign) return new Response("Not found",{status:404});
    if(["cancelled","paused","completed","failed"].includes(campaign.status)) return Response.json({ok:true,status:campaign.status});
    const template=Array.isArray(campaign.whatsapp_message_templates)?campaign.whatsapp_message_templates[0]:campaign.whatsapp_message_templates;
    if(!template||template.status!=="approved") throw new Error("Template oficial não aprovado.");
    const {data:connection}=await admin.from("whatsapp_connections").select("id,phone_number_id,graph_api_version,status").eq("establishment_id",campaign.establishment_id).eq("status","connected").maybeSingle();
    if(!connection) throw new Error("Conexão do WhatsApp indisponível.");
    const {data:secret}=await admin.rpc("get_whatsapp_connection_secret",{requested_connection_id:connection.id});
    if(!secret?.access_token) throw new Error("Credencial do WhatsApp indisponível.");

    const {data:batch}=await admin.from("crm_campaign_recipients").select("id,customer_id,whatsapp_contact_id,wa_id,attempts,variant,customers(name,marketing_status),whatsapp_contacts(marketing_opt_out,blocked_at)").eq("campaign_id",campaignId).in("status",["pending","failed"]).lte("next_attempt_at",new Date().toISOString()).lt("attempts",3).order("created_at").limit(25);
    for(const row of batch||[]) {
      const customer=Array.isArray(row.customers)?row.customers[0]:row.customers;
      const contact=Array.isArray(row.whatsapp_contacts)?row.whatsapp_contacts[0]:row.whatsapp_contacts;
      if(customer?.marketing_status!=="opted_in"||contact?.marketing_opt_out||contact?.blocked_at) {
        await admin.from("crm_campaign_recipients").update({status:"skipped",error_message:"Sem consentimento ativo ou contato bloqueado.",updated_at:new Date().toISOString()}).eq("id",row.id).eq("campaign_id",campaignId);
        continue;
      }
      const attempts=Number(row.attempts||0)+1;
      const {data:claimed}=await admin.from("crm_campaign_recipients").update({status:"processing",attempts,error_message:null,updated_at:new Date().toISOString()}).eq("id",row.id).in("status",["pending","failed"]).select("id").maybeSingle();
      if(!claimed) continue;
      try {
        const variables={nome_cliente:String(customer?.name||"Cliente"),nome_loja:String(campaign.establishments?.name||"nossa loja"),cupom:String(campaign.coupons?.code||""),produto:String(campaign.variables?.produto||""),link_cardapio:`${Deno.env.get("PUBLIC_SITE_URL")||""}/loja/${campaign.establishments?.slug||""}`,...(row.variant==="B"?campaign.variant_b_variables:campaign.variables)} as Record<string,string>;
        const required=Array.isArray(template.variables)?template.variables:[];
        if(required.some((key:string)=>!String(variables[key]||"").trim())) throw new Error("Variável obrigatória sem valor seguro.");
        const parameters=required.map((key:string)=>({type:"text",text:String(variables[key]).slice(0,1024)}));
        const components=parameters.length?[{type:"body",parameters}]:undefined;
        const response=await fetch(`https://graph.facebook.com/${connection.graph_api_version||"v23.0"}/${connection.phone_number_id}/messages`,{method:"POST",headers:{Authorization:`Bearer ${secret.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",recipient_type:"individual",to:row.wa_id,type:"template",template:{name:template.name,language:{code:template.language},components}})});
        const result=await response.json() as {messages?:Array<{id:string}>;error?:{message?:string}};
        if(!response.ok||!result.messages?.[0]?.id) throw new Error(result.error?.message||`Meta ${response.status}`);
        const now=new Date().toISOString();
        const preview=fill(template.body,variables).slice(0,4096);
        const {data:conversation}=await admin.from("whatsapp_conversations").select("id").eq("contact_id",row.whatsapp_contact_id).eq("establishment_id",campaign.establishment_id).maybeSingle();
        if(conversation) await admin.from("whatsapp_messages").insert({establishment_id:campaign.establishment_id,conversation_id:conversation.id,contact_id:row.whatsapp_contact_id,whatsapp_message_id:result.messages[0].id,direction:"outbound",message_type:"template",content:preview,status:"sent",automation_generated:true,message_timestamp:now});
        await admin.from("crm_campaign_recipients").update({status:"sent",whatsapp_message_id:result.messages[0].id,sent_at:now,error_message:null,updated_at:now}).eq("id",row.id);
        await admin.from("crm_campaign_events").insert({establishment_id:campaign.establishment_id,campaign_id:campaignId,recipient_id:row.id,event_type:"sent",metadata:{whatsapp_message_id:result.messages[0].id,variant:row.variant}});
      } catch(error) {
        const exhausted=attempts>=3; const delay=Math.min(60,2**attempts);
        await admin.from("crm_campaign_recipients").update({status:"failed",error_message:(error instanceof Error?error.message:"Falha no envio").slice(0,500),next_attempt_at:new Date(Date.now()+delay*60_000).toISOString(),updated_at:new Date().toISOString()}).eq("id",row.id);
        if(exhausted) await admin.from("crm_campaign_events").insert({establishment_id:campaign.establishment_id,campaign_id:campaignId,recipient_id:row.id,event_type:"failed",metadata:{attempts}});
      }
    }
    const {count:remaining}=await admin.from("crm_campaign_recipients").select("id",{head:true,count:"exact"}).eq("campaign_id",campaignId).in("status",["pending","failed","processing"]);
    if(!remaining) await admin.from("crm_campaigns").update({status:"completed",updated_at:new Date().toISOString()}).eq("id",campaignId).eq("status","processing");
    else if((batch||[]).length) await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/process-whatsapp-campaign-batch`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({campaign_id:campaignId,token})});
    return Response.json({ok:true,processed:(batch||[]).length,remaining:remaining||0});
  } catch(error) {
    console.error(error); return Response.json({error:error instanceof Error?error.message:"Campaign delivery failed"},{status:500});
  }
});
