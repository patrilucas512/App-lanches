import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request:Request) {
  try {
    const {establishment_id}=await request.json() as {establishment_id?:string};
    const establishmentId=String(establishment_id||""); const supabase=await createClient();
    const {data:{user}}=await supabase.auth.getUser(); if(!user)return NextResponse.json({error:"Sessão expirada."},{status:401});
    const [{data:member},{data:permission}]=await Promise.all([
      supabase.from("establishment_members").select("role").eq("establishment_id",establishmentId).eq("user_id",user.id).maybeSingle(),
      supabase.from("crm_member_permissions").select("can_create_campaign").eq("establishment_id",establishmentId).eq("user_id",user.id).maybeSingle(),
    ]);
    if(!["owner","manager"].includes(String(member?.role))&&!permission?.can_create_campaign)return NextResponse.json({error:"Sem permissão para sincronizar templates."},{status:403});
    const admin=createAdminClient(); const {data:connection}=await admin.from("whatsapp_connections").select("id,whatsapp_business_account_id,graph_api_version").eq("establishment_id",establishmentId).eq("status","connected").single();
    const {data:secret}=await admin.rpc("get_whatsapp_connection_secret",{requested_connection_id:connection.id});
    const response=await fetch(`https://graph.facebook.com/${connection.graph_api_version||"v23.0"}/${connection.whatsapp_business_account_id}/message_templates?fields=id,name,status,category,language,components&limit=100`,{headers:{Authorization:`Bearer ${secret.access_token}`},cache:"no-store"});
    const result=await response.json() as {data?:Array<{id:string;name:string;status:string;category:string;language:string;components:Array<{type:string;text?:string}>}>;error?:{message?:string}};
    if(!response.ok)return NextResponse.json({error:result.error?.message||"A Meta recusou a sincronização."},{status:400});
    const {data:existing}=await admin.from("whatsapp_message_templates").select("name,language,variables").eq("establishment_id",establishmentId);
    const variableMap=new Map((existing||[]).map(item=>[`${item.name}:${item.language}`,item.variables]));
    const allowed=new Set(["pending","approved","rejected","paused","disabled"]); const now=new Date().toISOString();
    const rows=(result.data||[]).map(item=>{const status=item.status.toLowerCase();const body=item.components?.find(component=>component.type==="BODY")?.text||"";return {establishment_id:establishmentId,meta_template_id:item.id,name:item.name,category:item.category,language:item.language,status:allowed.has(status)?status:"pending",body,components:item.components||[],variables:variableMap.get(`${item.name}:${item.language}`)||[],synced_at:now,updated_at:now};});
    if(rows.length){const {error}=await admin.from("whatsapp_message_templates").upsert(rows,{onConflict:"establishment_id,name,language"});if(error)throw error;}
    await admin.from("audit_logs").insert({establishment_id:establishmentId,actor_id:user.id,action:"crm.templates_synced",entity_type:"whatsapp_template",metadata:{count:rows.length}});
    return NextResponse.json({templates:rows,count:rows.length});
  } catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível sincronizar templates."},{status:500});}
}
