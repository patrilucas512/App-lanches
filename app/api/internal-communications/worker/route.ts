/* eslint-disable @typescript-eslint/no-explicit-any */
import{NextResponse}from"next/server";import{workerAuthorized}from"@/lib/worker-auth";import{createAdminClient}from"@/lib/supabase/admin";import{publishNotification}from"@/lib/notifications/publisher";import{publishDueAnnouncements}from"@/lib/internal-communications/announcements";import{organizationsWithComms}from"@/lib/internal-communications/dashboard";import{expireAnnouncements,reconcileLateJoiners,remindEmergencyReviews,runDelivery,scanAcknowledgements}from"@/lib/internal-communications/delivery";
// Orders and payments do not call this worker: it can be down without blocking anyone, and the next run catches up.
export async function POST(req:Request){const admin=createAdminClient();if(!await workerAuthorized(admin,req,{envSecret:process.env.INTERNAL_COMMUNICATIONS_WORKER_SECRET||process.env.CRON_SECRET,vaultName:"cx_worker_secret"}))return NextResponse.json({error:"Unauthorized"},{status:401});
 const params=new URL(req.url).searchParams,now=new Date(),nowIso=now.toISOString(),ctx={admin,notify:publishNotification};
 // Work left behind by a worker that died goes back to the queue instead of staying stuck.
 await admin.from("comms_jobs").update({status:"queued",lease_expires_at:null}).eq("status","running").lt("lease_expires_at",nowIso);
 if(params.get("enqueue")==="1")for(const organizationId of await organizationsWithComms(admin)){const{error}=await admin.from("comms_jobs").insert({organization_id:organizationId,job_type:"scan",priority:10});if(error&&error.code!=="23505")throw new Error(error.message)}
 // Crisis jobs carry the highest priority, so they go first in every batch.
 const{data:jobs}=await admin.from("comms_jobs").select("*").eq("status","queued").lte("available_at",nowIso).order("priority",{ascending:false}).order("available_at").limit(25);let completed=0,failed=0;
 for(const job of jobs||[]){const{data:lease}=await admin.from("comms_jobs").update({status:"running",attempt_count:job.attempt_count+1,lease_expires_at:new Date(now.getTime()+12e4).toISOString()}).eq("id",job.id).eq("status","queued").select("id").maybeSingle();if(!lease)continue;
  try{let again=false;
   if(job.job_type==="deliver"){const result=await runDelivery(ctx,job.announcement_id,{now});again=result.remaining>0}
   else{await publishDueAnnouncements({admin,notify:publishNotification,organizationId:job.organization_id,flags:{comms_crisis_enabled:true},permissions:[]},now);await expireAnnouncements(admin,job.organization_id,now);await reconcileLateJoiners(ctx,job.organization_id,now);await scanAcknowledgements(ctx,job.organization_id,now);await remindEmergencyReviews(ctx,job.organization_id,now)}
   await admin.from("comms_jobs").update(again?{status:"queued",attempt_count:0,available_at:new Date(Date.now()+6e4).toISOString(),lease_expires_at:null,error_message:null}:{status:"completed",completed_at:new Date().toISOString(),error_message:null,lease_expires_at:null}).eq("id",job.id);completed++}
  catch(error:any){const dead=job.attempt_count+1>=job.max_attempts;await admin.from("comms_jobs").update({status:dead?"dead_letter":"queued",error_message:String(error?.message||"Falha").slice(0,300),lease_expires_at:null,available_at:new Date(Date.now()+(job.attempt_count+1)*12e4).toISOString()}).eq("id",job.id);failed++}}
 return NextResponse.json({completed,failed})}
