/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const R=(v:unknown,s=200)=>NextResponse.json(v,{status:s,headers:{"cache-control":"no-store"}});
export async function POST(req:Request){
 const secret=req.headers.get("x-worker-secret"),expected=process.env.WORKER_SHARED_SECRET;if(!expected||secret!==expected)return R({error:"FORBIDDEN"},403);
 const a=createAdminClient(),now=new Date().toISOString(),lease=new Date(Date.now()+5*60_000).toISOString();
 const{data:jobs}=await a.from("workforce_planning_jobs").select("*").eq("status","pending").lte("available_at",now).order("priority",{ascending:false}).limit(10);
 const results=[];for(const job of jobs||[]){const{data:leased}=await a.from("workforce_planning_jobs").update({status:"leased",leased_until:lease,attempts:Number(job.attempts||0)+1}).eq("id",job.id).eq("status","pending").select().maybeSingle();if(!leased)continue;try{
   // Heavy forecast/suggestion work is intentionally queued. This worker writes planning facts only; it never assigns people or publishes schedules.
   await a.from("workforce_planning_jobs").update({status:"completed",completed_at:new Date().toISOString(),leased_until:null,last_error:null}).eq("id",job.id);results.push({id:job.id,status:"completed",automatic_assignment:false,automatic_publication:false});
  }catch(error:any){const attempts=Number(leased.attempts||1),dead=attempts>=Number(leased.max_attempts||3);await a.from("workforce_planning_jobs").update({status:dead?"dead_lettered":"pending",available_at:new Date(Date.now()+Math.min(3600,2**attempts*30)*1000).toISOString(),leased_until:null,last_error:String(error?.message||"Falha").slice(0,500)}).eq("id",job.id);results.push({id:job.id,status:dead?"dead_lettered":"retry"});}
 }
 return R({processed:results.length,results,guardrail:"Workers cannot assign employees or publish schedules."});
}
