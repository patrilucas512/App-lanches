/* eslint-disable @typescript-eslint/no-explicit-any */
import{NextResponse}from"next/server";import{workerAuthorized}from"@/lib/worker-auth";import{createAdminClient}from"@/lib/supabase/admin";import{publishNotification}from"@/lib/notifications/publisher";import{contextsWithPrivacy}from"@/lib/privacy-operations/dashboard";import{scanDeadlines}from"@/lib/privacy-operations/dsr";import{executePlan}from"@/lib/privacy-operations/deletion";import{isNotInstalled}from"@/lib/privacy-operations/server";
// Deadline alerts and resuming approved deletions that stopped half way. Orders, login and payments never call this worker.
// Phase 95 does not schedule it in production; that is a separate step with the owner's approval.
export async function POST(req:Request){const admin=createAdminClient();if(!await workerAuthorized(admin,req,{envSecret:process.env.PRIVACY_WORKER_SECRET||process.env.CRON_SECRET,vaultName:"privacy_worker_secret"}))return NextResponse.json({error:"Unauthorized"},{status:401});
 let contexts:any[]=[];try{contexts=await contextsWithPrivacy(admin)}catch(error:any){if(isNotInstalled(error))return NextResponse.json({error:"PRIVACY_NOT_INSTALLED"},{status:503});throw error}
 let alerted=0,resumed=0,failed=0;
 for(const context of contexts){const ctx={admin,organizationId:context.organization_id,contextId:context.id,actorId:null,actorType:"system",notify:publishNotification,permissions:[]};
  try{alerted+=(await scanDeadlines(ctx)).alerted;
   const{data:plans}=await admin.from("privacy_deletion_plans").select("id").eq("context_id",context.id).eq("status","running").lt("updated_at",new Date(Date.now()-15*6e4).toISOString()).limit(5);
   for(const plan of plans||[]){await executePlan(ctx,{planId:plan.id,limit:200});resumed++}
  }catch{failed++}}
 return NextResponse.json({contexts:contexts.length,alerted,resumed,failed})}
