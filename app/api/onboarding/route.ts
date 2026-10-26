import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";

async function context(){
  const supabase=await createClient(); const {data:claims}=await supabase.auth.getClaims(); const userId=claims?.claims?.sub;
  if(!userId) return null;
  const cookieStore=await cookies(); const activeStoreId=cookieStore.get("masterapp_active_store")?.value;
  const {data:members}=await supabase.from("establishment_members").select("establishment_id,role").eq("user_id",userId).eq("status","active").order("created_at");
  const member=members?.find(item=>item.establishment_id===activeStoreId)||members?.[0];
  if(!member) return null;
  const {data:store}=await supabase.from("establishments").select("id,organization_id,name,slug,onboarding_completed").eq("id",member.establishment_id).single();
  return store?{supabase,userId,member,store}:null;
}

async function snapshot(ctx:NonNullable<Awaited<ReturnType<typeof context>>>){
  const {data:sessionId,error:startError}=await ctx.supabase.rpc("start_or_resume_onboarding",{requested_organization_id:ctx.store.organization_id,requested_establishment_id:ctx.store.id});
  if(startError) throw startError;
  await ctx.supabase.rpc("refresh_onboarding_progress",{requested_session_id:sessionId});
  const [{data:session},{data:steps},{data:organization},{data:testOrders},{data:jobs},{data:recommendations}]=await Promise.all([
    ctx.supabase.from("onboarding_sessions").select("*").eq("id",sessionId).single(),
    ctx.supabase.from("onboarding_steps").select("*,onboarding_step_catalog(title,description,sort_order,skippable,route,entitlement_key)").eq("session_id",sessionId),
    ctx.supabase.from("organizations").select("id,name,business_type,operating_profile,timezone,activated_at").eq("id",ctx.store.organization_id).single(),
    ctx.supabase.from("onboarding_test_orders").select("id,status,fulfillment_type,timeline,created_at").eq("session_id",sessionId).order("created_at",{ascending:false}).limit(1),
    ctx.supabase.from("migration_jobs").select("id,migration_type,status,progress_percent,imported_rows,failed_rows,duplicate_rows,created_at").eq("organization_id",ctx.store.organization_id).order("created_at",{ascending:false}).limit(5),
    ctx.supabase.from("onboarding_recommendations").select("id,recommendation_key,title,body,priority,route,status").eq("organization_id",ctx.store.organization_id).eq("establishment_id",ctx.store.id).eq("status","active").order("priority",{ascending:false}),
  ]);
  return {session,steps:(steps||[]).sort((a:any,b:any)=>(a.onboarding_step_catalog?.sort_order||0)-(b.onboarding_step_catalog?.sort_order||0)),organization,store:ctx.store,testOrder:testOrders?.[0]||null,migrationJobs:jobs||[],recommendations:recommendations||[]};
}

export async function GET(){try{const ctx=await context();if(!ctx)return NextResponse.json({error:"Não autorizado"},{status:401});return NextResponse.json(await snapshot(ctx));}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Falha no onboarding"},{status:400});}}

const bodySchema=z.object({action:z.string(),sessionId:z.string().uuid().optional(),step:z.string().optional(),status:z.enum(["pending","in_progress","completed","skipped"]).optional(),snapshot:z.record(z.string(),z.unknown()).optional(),assignee:z.string().uuid().nullable().optional(),businessType:z.string().max(80).optional(),profile:z.record(z.string(),z.boolean()).optional(),name:z.string().min(2).max(120).optional(),phone:z.string().max(40).optional(),address:z.string().max(300).optional(),timezone:z.string().max(80).optional(),currency:z.string().max(3).optional(),template:z.string().max(40).optional(),fulfillment:z.enum(["pickup","delivery"]).optional()});

export async function POST(request:Request){try{
  const ctx=await context();if(!ctx)return NextResponse.json({error:"Não autorizado"},{status:401});
  const body=bodySchema.parse(await request.json());
  const {data:sessionId}=body.sessionId?{data:body.sessionId}:await ctx.supabase.rpc("start_or_resume_onboarding",{requested_organization_id:ctx.store.organization_id,requested_establishment_id:ctx.store.id});
  if(!sessionId)throw new Error("Sessão indisponível");
  if(body.action==="profile"){
    await ctx.supabase.from("organizations").update({business_type:body.businessType,operating_profile:body.profile||{},timezone:body.timezone||"America/Sao_Paulo"}).eq("id",ctx.store.organization_id);
    if(body.name||body.phone||body.timezone)await ctx.supabase.from("establishments").update({...(body.name&&{name:body.name}),...(body.phone&&{phone:body.phone}),...(body.timezone&&{timezone:body.timezone})}).eq("id",ctx.store.id);
    const {data:settings}=await ctx.supabase.from("establishment_settings").select("address,currency,timezone").eq("establishment_id",ctx.store.id).maybeSingle();
    await ctx.supabase.from("establishment_settings").upsert({establishment_id:ctx.store.id,address:{...(settings?.address||{}),...(body.address&&{street:body.address})},currency:body.currency||settings?.currency||"BRL",timezone:body.timezone||settings?.timezone||"America/Sao_Paulo"});
    const {error}=await ctx.supabase.rpc("set_onboarding_step_status",{requested_session_id:sessionId,requested_step:"business_profile",requested_status:"completed",requested_snapshot:{business_type:body.businessType,profile:body.profile||{}},requested_assignee:null});if(error)throw error;
  }else if(body.action==="step"){
    if(!body.step||!body.status)throw new Error("Etapa e status são obrigatórios");
    const {error}=await ctx.supabase.rpc("set_onboarding_step_status",{requested_session_id:sessionId,requested_step:body.step,requested_status:body.status,requested_snapshot:body.snapshot||{},requested_assignee:body.assignee||null});if(error)throw error;
  }else if(body.action==="template"){
    const {error}=await ctx.supabase.rpc("apply_onboarding_menu_template",{requested_session_id:sessionId,requested_template:body.template||"restaurante"});if(error)throw error;
  }else if(body.action==="test_order"){
    const {error}=await ctx.supabase.rpc("create_onboarding_test_order",{requested_session_id:sessionId,requested_fulfillment:body.fulfillment||"pickup"});if(error)throw error;
  }else if(body.action==="activate"){
    const {data,error}=await ctx.supabase.rpc("activate_store_from_onboarding",{requested_session_id:sessionId});if(error)throw error;if(!data?.ready)return NextResponse.json({error:"Complete os itens essenciais antes de ativar.",readiness:data},{status:409});
  }else throw new Error("Ação desconhecida");
  return NextResponse.json(await snapshot(ctx));
}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível salvar"},{status:400});}}
