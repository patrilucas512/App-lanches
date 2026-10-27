import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const digits=(value:string)=>value.replace(/\D/g,"").replace(/^(?!55)(?=\d{10,11}$)/,"55");

export async function POST(request:Request) {
  try {
    const body=await request.json() as {establishment_id?:string;campaign_id?:string;phone?:string};
    const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser();
    if(!user) return NextResponse.json({error:"Sessão expirada."},{status:401});
    const establishmentId=String(body.establishment_id||""); const campaignId=String(body.campaign_id||"");
    const [{data:member},{data:permission},{data:settings}]=await Promise.all([
      supabase.from("establishment_members").select("role").eq("establishment_id",establishmentId).eq("user_id",user.id).maybeSingle(),
      supabase.from("crm_member_permissions").select("can_create_campaign").eq("establishment_id",establishmentId).eq("user_id",user.id).maybeSingle(),
      supabase.from("establishment_settings").select("whatsapp").eq("establishment_id",establishmentId).maybeSingle(),
    ]);
    if(!["owner","manager"].includes(String(member?.role))&&!permission?.can_create_campaign) return NextResponse.json({error:"Sem permissão para enviar teste."},{status:403});
    const target=digits(String(body.phone||"")); const authorized=digits(String(settings?.whatsapp||""));
    if(!target||target!==authorized) return NextResponse.json({error:"O teste só pode ser enviado ao WhatsApp autorizado da própria empresa."},{status:400});
    const admin=createAdminClient();
    const [{data:campaign},{data:connection}]=await Promise.all([
      admin.from("crm_campaigns").select("id,variables,variant_b_variables,whatsapp_message_templates(name,language,status,variables),establishments(name,slug),coupons(code),products(name)").eq("id",campaignId).eq("establishment_id",establishmentId).single(),
      admin.from("whatsapp_connections").select("id,phone_number_id,graph_api_version").eq("establishment_id",establishmentId).eq("status","connected").single(),
    ]);
    const template=Array.isArray(campaign?.whatsapp_message_templates)?campaign.whatsapp_message_templates[0]:campaign?.whatsapp_message_templates;
    if(!template||template.status!=="approved") return NextResponse.json({error:"Escolha um template aprovado pela Meta."},{status:400});
    const {data:secret}=await admin.rpc("get_whatsapp_connection_secret",{requested_connection_id:connection.id});
    const variables={nome_cliente:"Cliente teste",nome_loja:String(campaign?.establishments?.name||"Loja"),cupom:String(campaign?.coupons?.code||""),produto:String(campaign?.products?.name||campaign?.variables?.produto||""),link_cardapio:`${process.env.NEXT_PUBLIC_SITE_URL||""}/loja/${campaign?.establishments?.slug||""}`,...campaign?.variables} as Record<string,string>;
    const keys=Array.isArray(template.variables)?template.variables:[];
    if(keys.some((key:string)=>!String(variables[key]||"").trim())) return NextResponse.json({error:"Preencha todas as variáveis obrigatórias antes do teste."},{status:400});
    const components=keys.length?[{type:"body",parameters:keys.map((key:string)=>({type:"text",text:String(variables[key]).slice(0,1024)}))}]:undefined;
    const response=await fetch(`https://graph.facebook.com/${connection.graph_api_version||"v23.0"}/${connection.phone_number_id}/messages`,{method:"POST",headers:{Authorization:`Bearer ${secret.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",to:target,type:"template",template:{name:template.name,language:{code:template.language},components}})});
    const result=await response.json() as {messages?:Array<{id:string}>;error?:{message?:string}};
    if(!response.ok) return NextResponse.json({error:result.error?.message||"A Meta recusou o teste."},{status:400});
    await admin.from("crm_campaign_events").insert({establishment_id:establishmentId,campaign_id:campaignId,event_type:"test_sent",metadata:{actor_id:user.id,target:"company_whatsapp",message_id:result.messages?.[0]?.id||null}});
    return NextResponse.json({sent:true});
  } catch(error) { return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível enviar o teste."},{status:500}); }
}
