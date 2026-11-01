/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"cache-control":"no-store","x-content-type-options":"nosniff"}});

export async function POST(req:Request){
  const secret=process.env.MDM_WORKER_SECRET||process.env.CRON_SECRET;
  if(!secret||req.headers.get("authorization")!==`Bearer ${secret}`)return reply({error:"UNAUTHORIZED"},401);
  const admin=createAdminClient(),started=Date.now();
  const{data:job,error}=await admin.from("master_dedup_jobs").select("*").eq("status","queued").order("created_at").limit(1).maybeSingle();
  if(error)return reply({error:error.message},500);if(!job)return reply({processed:0,status:"idle"});
  const leased=await admin.from("master_dedup_jobs").update({status:"running",started_at:new Date().toISOString(),progress:{phase:"blocking",processed:0}}).eq("id",job.id).eq("status","queued").select().maybeSingle();
  if(leased.error||!leased.data)return reply({processed:0,status:"leased_elsewhere"});
  try{
    const maxCandidates=Math.min(5000,Math.max(1,Number(job.scope?.max_candidates||1000))),{data:index,error:indexError}=await admin.from("master_match_index").select("master_entity_id,block_key,blocking_version").eq("organization_id",job.organization_id).eq("entity_type",job.entity_type).order("block_key").limit(20000);if(indexError)throw indexError;
    const buckets=new Map<string,string[]>();for(const row of index||[]){const list=buckets.get(row.block_key)||[];if(list.length<200)list.push(row.master_entity_id);buckets.set(row.block_key,list)}
    const pairs=new Map<string,{organization_id:string;dedup_job_id:string;entity_a:string;entity_b:string;match_level:string;score:number;reasons:any[];conflicts:any[];recommendation:string;status:string;rule_version:number}>();
    for(const[block,ids]of buckets){for(let i=0;i<ids.length&&pairs.size<maxCandidates;i++)for(let j=i+1;j<ids.length&&pairs.size<maxCandidates;j++){const[a,b]=[ids[i],ids[j]].sort(),key=`${a}:${b}`;if(!pairs.has(key))pairs.set(key,{organization_id:job.organization_id,dedup_job_id:job.id,entity_a:a,entity_b:b,match_level:"strong",score:80,reasons:[{field:"blocking_key",matchType:"normalized_exact",blockHash:block}],conflicts:[],recommendation:"human_review",status:"pending",rule_version:Number(job.rule_version||1)})}}
    const rows=[...pairs.values()];if(rows.length){const inserted=await admin.from("master_match_candidates").upsert(rows,{onConflict:"organization_id,entity_a,entity_b,rule_version",ignoreDuplicates:true});if(inserted.error)throw inserted.error}
    await admin.from("master_dedup_jobs").update({status:"completed",candidate_count:rows.length,completed_at:new Date().toISOString(),progress:{phase:"completed",processed:(index||[]).length,candidates:rows.length,truncated:rows.length>=maxCandidates},metrics:{duration_ms:Date.now()-started,global_quadratic_scan:false,buckets:buckets.size}}).eq("id",job.id);
    return reply({processed:1,job_id:job.id,candidates:rows.length,global_quadratic_scan:false});
  }catch(error:any){await admin.from("master_dedup_jobs").update({status:"failed",completed_at:new Date().toISOString(),error_message:String(error?.message||"worker_failed").slice(0,500)}).eq("id",job.id);return reply({error:"MDM_WORKER_FAILED",job_id:job.id},500)}
}
