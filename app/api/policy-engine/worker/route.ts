import {NextResponse} from "next/server";
import {createAdminClient} from "@/lib/supabase/admin";

export async function POST(request:Request){
  const token=request.headers.get("x-worker-token");if(!process.env.INTERNAL_WORKER_TOKEN||token!==process.env.INTERNAL_WORKER_TOKEN)return NextResponse.json({error:"FORBIDDEN"},{status:403});
  const admin=createAdminClient(),now=new Date().toISOString();
  const[{data:expired},{data:stale}]=await Promise.all([
    admin.from("policy_exceptions").update({status:"expired"}).eq("status","active").lte("valid_until",now).select("id,organization_id,policy_id"),
    admin.from("policy_health_results").select("id,organization_id,policy_id,measured_at").lt("measured_at",new Date(Date.now()-24*60*60*1000).toISOString()).limit(250)
  ]);
  for(const item of expired||[])await admin.from("policy_audit_events").insert({organization_id:item.organization_id,event_type:"policy.exception_expired",entity_type:"policy_exception",entity_id:item.id,reason:"Expiração automática por prazo"});
  for(const item of stale||[])await admin.from("policy_health_results").update({health_status:"stale"}).eq("id",item.id);
  return NextResponse.json({ok:true,expiredExceptions:expired?.length||0,staleHealth:stale?.length||0,automaticPolicyPublication:false,automaticActionExecution:false});
}
