/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NetworkInventoryService, SafetyStockService, StockoutRiskService } from "@/lib/supply-chain-planning/core";

export async function POST(request:Request){
  const secret=request.headers.get("x-worker-secret");if(!process.env.INTERNAL_WORKER_SECRET||secret!==process.env.INTERNAL_WORKER_SECRET)return NextResponse.json({error:"Não autorizado."},{status:401});
  const admin=createAdminClient(),worker=`supply-${crypto.randomUUID()}`,now=new Date().toISOString();
  const{data:jobs,error}=await admin.from("supply_planning_jobs").select("*").in("status",["queued","failed"]).lte("available_at",now).order("priority",{ascending:false}).limit(10);if(error)return NextResponse.json({error:error.message},{status:500});
  let completed=0,failed=0;
  for(const job of jobs||[]){
    const{data:claimed}=await admin.from("supply_planning_jobs").update({status:"leased",leased_at:now,leased_by:worker,attempts:Number(job.attempts||0)+1}).eq("id",job.id).in("status",["queued","failed"]).select().maybeSingle();if(!claimed)continue;
    try{
      const ids=Array.isArray(job.payload?.item_ids)?job.payload.item_ids:[],{data:items}=await admin.from("inventory_items").select("id,establishment_id,balance,reserved_quantity,minimum,safety_stock,supply_criticality").in("id",ids);
      for(const item of items||[]){const network=new NetworkInventoryService().calculate({onHand:Number(item.balance||0),reserved:Number(item.reserved_quantity||0)}),safety=new SafetyStockService().recommend({method:"fixed_quantity",fixedQuantity:Number(item.safety_stock||0)}),risk=new StockoutRiskService().evaluate({projectedStock:network.available-safety.recommendedSafetyStock});if(["high","critical"].includes(String(risk.risk))){await admin.from("supply_risk_events").upsert({organization_id:job.organization_id,inventory_item_id:item.id,risk_type:"projected_stockout",severity:risk.risk,status:"open",evidence:{...risk,network,safety},dedupe_key:`${item.establishment_id}:${item.id}:projected_stockout`},{onConflict:"organization_id,dedupe_key,status"});}}
      await admin.from("supply_planning_jobs").update({status:"completed",last_error:null}).eq("id",job.id);completed++;
    }catch(e:any){const dead=Number(claimed.attempts||1)>=Number(claimed.max_attempts||3);await admin.from("supply_planning_jobs").update({status:dead?"dead_letter":"failed",last_error:String(e?.message||e).slice(0,1000),available_at:new Date(Date.now()+120000).toISOString()}).eq("id",job.id);failed++;}
  }
  const runIds=[...new Set((jobs||[]).map((x:any)=>x.planning_run_id))];for(const id of runIds){const{count}=await admin.from("supply_planning_jobs").select("id",{count:"exact",head:true}).eq("planning_run_id",id).in("status",["queued","leased","failed"]);if(!count)await admin.from("supply_planning_runs").update({status:"completed",completed_at:new Date().toISOString()}).eq("id",id);}
  return NextResponse.json({worker,claimed:(jobs||[]).length,completed,failed,inventoryMutations:0,automaticPurchases:0,automaticTransfers:0,automaticProduction:0});
}
