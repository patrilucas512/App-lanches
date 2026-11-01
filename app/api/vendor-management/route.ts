/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { VENDOR_PERMISSIONS, vendorCopilot } from "@/lib/vendor-management/core";

const UUID=/^[0-9a-f-]{36}$/i;
const response=(body:any,status=200)=>NextResponse.json(body,{status,headers:{"cache-control":"private, no-store"}});

async function context(storeId:string){
  if(!UUID.test(storeId)) throw new Error("FORBIDDEN");
  const client=await createClient();
  const {data}=await client.auth.getClaims();
  const userId=String(data?.claims?.sub||"");
  if(!userId) throw new Error("AUTH");
  const admin=createAdminClient();
  const {data:store}=await admin.from("establishments").select("id,organization_id").eq("id",storeId).maybeSingle();
  if(!store) throw new Error("FORBIDDEN");
  const [{data:local},{data:org},{data:custom}]=await Promise.all([
    admin.from("establishment_members").select("role").eq("establishment_id",storeId).eq("user_id",userId).eq("status","active").maybeSingle(),
    admin.from("organization_members").select("role").eq("organization_id",store.organization_id).eq("user_id",userId).eq("active",true).maybeSingle(),
    admin.from("vendor_member_permissions").select("permission_key").eq("organization_id",store.organization_id).eq("user_id",userId),
  ]);
  if(!local&&!org) throw new Error("FORBIDDEN");
  const permissions=new Set<string>(["vendor:view",...(custom||[]).map((x:any)=>x.permission_key)]);
  const role=String(org?.role||local?.role||"member");
  if(["owner","admin"].includes(role)) VENDOR_PERMISSIONS.forEach(x=>permissions.add(x));
  return {admin,userId,organizationId:store.organization_id,permissions};
}
const requirePermission=(ctx:any,permission:string)=>{if(!ctx.permissions.has(permission))throw new Error("FORBIDDEN")};
const scoped=(ctx:any,table:string)=>ctx.admin.from(table).select("*").eq("organization_id",ctx.organizationId).limit(300);

async function dashboard(ctx:any){
  requirePermission(ctx,"vendor:view");
  const [vendors,onboarding,requirements,dueDiligence,contracts,performance,measurements,slas,slaEvents,costs,variances,risks,continuity,dependencies,alternatives,renewals,reviews,decisions,exitPlans,exitSteps,offboarding,access,exceptions]=await Promise.all([
    scoped(ctx,"vendor_profiles"),scoped(ctx,"vendor_onboarding_cases"),scoped(ctx,"vendor_onboarding_requirements"),scoped(ctx,"vendor_due_diligence_reviews"),scoped(ctx,"vendor_contract_links"),scoped(ctx,"vendor_performance_profiles"),scoped(ctx,"vendor_performance_measurements"),scoped(ctx,"vendor_sla_profiles"),scoped(ctx,"vendor_sla_events"),scoped(ctx,"vendor_cost_snapshots"),scoped(ctx,"vendor_commercial_variances"),scoped(ctx,"vendor_risk_links"),scoped(ctx,"vendor_continuity_links"),scoped(ctx,"vendor_dependency_links"),scoped(ctx,"vendor_alternatives"),scoped(ctx,"vendor_renewal_cases"),scoped(ctx,"vendor_reviews"),scoped(ctx,"vendor_decisions"),scoped(ctx,"vendor_exit_plans"),scoped(ctx,"vendor_exit_plan_steps"),scoped(ctx,"vendor_offboarding_cases"),scoped(ctx,"vendor_access_references"),scoped(ctx,"vendor_governance_exceptions")
  ]);
  const list=vendors.data||[], costList=costs.data||[], renewalList=renewals.data||[], exitList=exitPlans.data||[], slaList=slaEvents.data||[];
  const currencies=[...new Set(costList.map((x:any)=>x.currency))];
  return {vendors:list,onboarding:onboarding.data||[],requirements:requirements.data||[],dueDiligence:dueDiligence.data||[],contracts:contracts.data||[],performance:performance.data||[],measurements:measurements.data||[],slas:slas.data||[],slaEvents:slaList,costs:costList,variances:variances.data||[],risks:risks.data||[],continuity:continuity.data||[],dependencies:dependencies.data||[],alternatives:alternatives.data||[],renewals:renewalList,reviews:reviews.data||[],decisions:decisions.data||[],exitPlans:exitList,exitSteps:exitSteps.data||[],offboarding:offboarding.data||[],access:access.data||[],exceptions:exceptions.data||[],cards:{active:list.filter((x:any)=>x.relationship_status==="active").length,critical:list.filter((x:any)=>x.criticality==="critical").length,onboardingBlocked:(onboarding.data||[]).filter((x:any)=>x.status==="blocked").length,slaAlerts:slaList.filter((x:any)=>["at_risk","breach_candidate","breached_reviewed"].includes(x.status)).length,renewalsDue:renewalList.filter((x:any)=>["upcoming","review_required","under_review"].includes(x.status)).length,exitBlocked:exitList.filter((x:any)=>x.status==="blocked").length,costAmount:currencies.length===1?costList.reduce((sum:number,x:any)=>sum+Number(x.amount||0),0):null,costCurrency:currencies.length===1?currencies[0]:null},boundaries:{procurementCanonical:true,contractsCanonical:true,riskCanonical:true,reliabilityCanonical:true,continuityCanonical:true,architectureCanonical:true,finopsCanonical:true,automaticApproval:false,automaticTermination:false,silentCurrencyConversion:false}};
}

export async function GET(req:Request){try{return response(await dashboard(await context(String(new URL(req.url).searchParams.get("store_id")||""))))}catch(error:any){return response({error:error.message},error.message==="AUTH"?401:error.message==="FORBIDDEN"?403:500)}}

export async function POST(req:Request){
  try{
    const body=await req.json(),ctx=await context(String(body.store_id||"")),action=String(body.action||"");
    if(action==="create_vendor"){
      requirePermission(ctx,"vendor:create");
      const {data,error}=await ctx.admin.from("vendor_profiles").insert({context_type:"tenant_vendors",organization_id:ctx.organizationId,third_party_ref:body.third_party_ref||`manual:${crypto.randomUUID()}`,name:body.name,vendor_type:body.vendor_type||"other",criticality:body.criticality||"low",business_owner_ref:body.business_owner_ref||ctx.userId,relationship_status:"prospect"}).select().single();
      if(error)throw error; await audit(ctx,"vendor_registered","vendor_profile",data.id); return response({vendor:data},201);
    }
    if(action==="create_onboarding"){
      requirePermission(ctx,"vendor:manage_onboarding");
      const {data,error}=await ctx.admin.from("vendor_onboarding_cases").insert({vendor_profile_id:body.vendor_profile_id,organization_id:ctx.organizationId,onboarding_type:body.onboarding_type||"standard",owner_ref:body.owner_ref||ctx.userId,policy_profile_ref:body.policy_profile_ref||null}).select().single();
      if(error)throw error; await audit(ctx,"onboarding_started","vendor_onboarding_case",data.id); return response({onboarding:data},201);
    }
    if(action==="create_renewal"){
      requirePermission(ctx,"vendor:manage_renewals");
      const {data,error}=await ctx.admin.from("vendor_renewal_cases").insert({vendor_profile_id:body.vendor_profile_id,organization_id:ctx.organizationId,contract_id:body.contract_id||null,renewal_date:body.renewal_date||null,notice_deadline:body.notice_deadline||null,owner_ref:body.owner_ref||ctx.userId}).select().single();
      if(error)throw error; await audit(ctx,"renewal_review_created","vendor_renewal_case",data.id); return response({renewal:data},201);
    }
    if(action==="create_exit_plan"){
      requirePermission(ctx,"vendor:manage_exit");
      const {data,error}=await ctx.admin.from("vendor_exit_plans").insert({vendor_profile_id:body.vendor_profile_id,organization_id:ctx.organizationId,scenario:body.scenario||"custom",owner_ref:body.owner_ref||ctx.userId,target_exit_date:body.target_exit_date||null,plan_version:Number(body.plan_version||1)}).select().single();
      if(error)throw error; await audit(ctx,"exit_plan_created","vendor_exit_plan",data.id,{advisory_only:true}); return response({exitPlan:data},201);
    }
    if(action==="copilot"){requirePermission(ctx,"vendor:view");return response(vendorCopilot(body.tool,body.input||{}))}
    return response({error:"Ação inválida"},400);
  }catch(error:any){return response({error:error.message||"Falha na gestão de terceiros"},error.message==="AUTH"?401:error.message==="FORBIDDEN"?403:400)}
}
async function audit(ctx:any,action:string,resourceType:string,resourceId:string,metadata:any={}){await ctx.admin.from("vendor_audit_events").insert({context_type:"tenant_vendors",organization_id:ctx.organizationId,actor_id:ctx.userId,action,resource_type:resourceType,resource_id:resourceId,safe_metadata:metadata})}
