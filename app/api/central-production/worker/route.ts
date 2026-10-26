import{NextResponse}from"next/server";
import{createAdminClient}from"@/lib/supabase/admin";
import{ProductionPlanningService}from"@/lib/central-production/core";

export async function POST(request:Request){
 const configured=process.env.CRON_SECRET;if(!configured||request.headers.get("x-cron-secret")!==configured)return NextResponse.json({error:"FORBIDDEN"},{status:403});
 const admin=createAdminClient(),{data:runs,error}=await admin.rpc("claim_production_planning_runs",{requested_limit:5});if(error)return NextResponse.json({error:error.message},{status:500});
 const results=[] as {id:string;status:string}[];
 for(const run of runs||[]){try{const input=(run.inputs_snapshot||{}) as Parameters<ProductionPlanningService["suggest"]>[0],suggestions=new ProductionPlanningService().suggest(input);await admin.from("production_planning_runs").update({status:"completed",suggestions,warnings:suggestions.filter(x=>x.capacityExceeded).map(x=>({code:"capacity_exceeded",item_id:x.itemId,unmet_demand:x.unmetDemand})),completed_at:new Date().toISOString()}).eq("id",run.id);results.push({id:run.id,status:"completed"});}catch(error){await admin.from("production_planning_runs").update({status:"failed",error:error instanceof Error?error.message:"planning_failed",completed_at:new Date().toISOString()}).eq("id",run.id);results.push({id:run.id,status:"failed"});}}
 return NextResponse.json({claimed:(runs||[]).length,results,automaticOrderCreation:false},{headers:{"cache-control":"no-store"}});
}

