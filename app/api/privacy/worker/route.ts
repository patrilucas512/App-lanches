/* eslint-disable @typescript-eslint/no-explicit-any */
import{NextResponse}from"next/server";import{workerAuthorized}from"@/lib/worker-auth";import{createAdminClient}from"@/lib/supabase/admin";import{publishNotification}from"@/lib/notifications/publisher";import{contextsWithPrivacy}from"@/lib/privacy-operations/dashboard";import{scanDeadlines}from"@/lib/privacy-operations/dsr";import{executePlan}from"@/lib/privacy-operations/deletion";import{runRetention}from"@/lib/privacy-operations/retention";import{isNotInstalled}from"@/lib/privacy-operations/server";
// Deadline alerts and resuming approved deletions that stopped half way. Orders, login and payments never call this worker.
// Phase 95 does not schedule it in production; that is a separate step with the owner's approval.
export async function POST(req:Request){const admin=createAdminClient();if(!await workerAuthorized(admin,req,{envSecret:process.env.PRIVACY_WORKER_SECRET||process.env.CRON_SECRET,vaultName:"privacy_worker_secret"}))return NextResponse.json({error:"Unauthorized"},{status:401});
 let contexts:any[]=[];try{contexts=await contextsWithPrivacy(admin)}catch(error:any){if(isNotInstalled(error))return NextResponse.json({error:"PRIVACY_NOT_INSTALLED"},{status:503});throw error}
 let alerted=0,resumed=0,failed=0;
 for(const context of contexts){const ctx={admin,organizationId:context.organization_id,contextId:context.id,actorId:null,actorType:"system",notify:publishNotification,permissions:[]};
  try{alerted+=(await scanDeadlines(ctx)).alerted;
   const{data:plans}=await admin.from("privacy_deletion_plans").select("id").eq("context_id",context.id).eq("status","running").lt("updated_at",new Date(Date.now()-15*6e4).toISOString()).limit(5);
   for(const plan of plans||[]){await executePlan(ctx,{planId:plan.id,limit:200});resumed++}
   // Approved real retention runs with customers left: one more batch each. The store's execution flag is checked again.
   const[{data:runs},{data:flag}]=await Promise.all([admin.from("retention_runs").select("id,policy_id").eq("context_id",context.id).eq("mode","execute").eq("status","running").limit(3),admin.from("store_feature_flags").select("privacy_retention_execution_enabled,establishments!inner(organization_id)").eq("establishments.organization_id",context.organization_id).eq("privacy_retention_execution_enabled",true).limit(1).maybeSingle()]);
   for(const run of runs||[]){await runRetention({...ctx,flags:{privacy_retention_execution_enabled:Boolean(flag)}},{policyId:run.policy_id,mode:"execute",runId:run.id});resumed++}
  }catch{failed++}}
 return NextResponse.json({contexts:contexts.length,alerted,resumed,failed})}
