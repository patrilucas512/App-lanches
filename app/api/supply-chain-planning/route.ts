/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SUPPLY_CHAIN_PERMISSIONS, SupplyRecommendationExecutionService, SupplyScenarioService, partitionPlanningJobs } from "@/lib/supply-chain-planning/core";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"cache-control":"private, no-store"}});

async function context(storeId:string){
  if(!UUID.test(storeId))throw new Error("FORBIDDEN");
  const client=await createClient(),{data}=await client.auth.getClaims(),userId=String(data?.claims?.sub||"");
  if(!userId)throw new Error("AUTH");
  const admin=createAdminClient(),{data:store}=await admin.from("establishments").select("id,organization_id,name,slug").eq("id",storeId).maybeSingle();
  if(!store)throw new Error("FORBIDDEN");
  const[{data:local},{data:org}]=await Promise.all([
    admin.from("establishment_members").select("role").eq("establishment_id",storeId).eq("user_id",userId).eq("status","active").maybeSingle(),
    admin.from("organization_members").select("role,all_stores").eq("organization_id",store.organization_id).eq("user_id",userId).eq("active",true).maybeSingle()
  ]);
  if(!local&&!org)throw new Error("FORBIDDEN");
  const role=String(org?.role||local?.role||"member"),permissions=new Set<string>(["supply_chain:view"]);
  if(["owner","admin","manager","supervisor"].includes(role))SUPPLY_CHAIN_PERMISSIONS.forEach(p=>permissions.add(p));
  return{admin,userId,store,storeId,organizationId:store.organization_id,permissions,network:Boolean(org?.all_stores)&&permissions.has("supply_chain:view_network")};
}
const requirePermission=(c:any,p:string)=>{if(!c.permissions.has(p))throw new Error("FORBIDDEN")};
async function audit(c:any,action:string,entityType:string,entityId:string|null,reason:unknown,before:unknown,after:unknown){
  await c.admin.from("supply_audit_events").insert({organization_id:c.organizationId,actor_user_id:c.userId,action,entity_type:entityType,entity_id:entityId,reason:String(reason||"").slice(0,500)||null,before_state:before??null,after_state:after??null});
}

async function load(c:any){
  const scope=(query:any)=>c.network?query:query.eq("establishment_id",c.storeId);
  const[nodes,links,items,lots,movements,recommendations,risks,policies,scenarios,runs,services,stores,purchases,transfers,production]=await Promise.all([
    c.admin.from("supply_nodes").select("*").eq("organization_id",c.organizationId).order("name"),
    c.admin.from("supply_links").select("*").eq("organization_id",c.organizationId).order("priority"),
    scope(c.admin.from("inventory_items").select("id,establishment_id,name,unit,balance,reserved_quantity,minimum,maximum,safety_stock,average_cost_cents,supply_criticality,planning_enabled,active").eq("organization_id",c.organizationId).eq("active",true)).order("name").limit(3000),
    c.admin.from("inventory_lots").select("id,store_id,inventory_item_id,quantity_available,status,expiration_at,internal_lot_code").eq("organization_id",c.organizationId).limit(3000),
    scope(c.admin.from("inventory_movements").select("id,establishment_id,stock_item_id,quantity,balance_after,kind,created_at").eq("organization_id",c.organizationId)).order("created_at",{ascending:false}).limit(5000),
    c.admin.from("supply_recommendations").select("*").eq("organization_id",c.organizationId).order("created_at",{ascending:false}).limit(500),
    c.admin.from("supply_risk_events").select("*").eq("organization_id",c.organizationId).order("detected_at",{ascending:false}).limit(500),
    c.admin.from("replenishment_policies").select("*").eq("organization_id",c.organizationId).order("updated_at",{ascending:false}).limit(500),
    c.admin.from("supply_scenarios").select("*").eq("organization_id",c.organizationId).order("updated_at",{ascending:false}).limit(100),
    c.admin.from("supply_planning_runs").select("*").eq("organization_id",c.organizationId).order("created_at",{ascending:false}).limit(30),
    c.admin.from("supply_service_level_snapshots").select("*").eq("organization_id",c.organizationId).order("period_end",{ascending:false}).limit(300),
    c.admin.from("establishments").select("id,name,slug,organization_id").eq("organization_id",c.organizationId).order("name"),
    c.admin.from("purchase_orders").select("id,establishment_id,status,expected_date,total_cents,created_at").eq("organization_id",c.organizationId).limit(500),
    c.admin.from("inventory_transfers").select("id,source_establishment_id,destination_establishment_id,status,created_at").eq("organization_id",c.organizationId).limit(500),
    c.admin.from("production_orders").select("id,status,planned_quantity,planned_start_at,planned_end_at,production_unit_id").eq("organization_id",c.organizationId).limit(500)
  ]);
  const itemRows=items.data||[],lotRows=lots.data||[],recRows=recommendations.data||[],riskRows=risks.data||[],usableLots=lotRows.filter((x:any)=>["active","released"].includes(x.status)&&(!x.expiration_at||Date.parse(x.expiration_at)>Date.now()));
  const onHand=itemRows.reduce((s:number,x:any)=>s+Number(x.balance||0),0),reserved=itemRows.reduce((s:number,x:any)=>s+Number(x.reserved_quantity||0),0),stockout=itemRows.filter((x:any)=>Number(x.balance||0)-Number(x.reserved_quantity||0)<=Number(x.minimum||0));
  return{nodes:nodes.data||[],links:links.data||[],items:itemRows,lots:lotRows,usableLots,movements:movements.data||[],recommendations:recRows,risks:riskRows,policies:policies.data||[],scenarios:scenarios.data||[],runs:runs.data||[],serviceLevels:services.data||[],stores:stores.data||[],officialExecution:{purchaseOrders:purchases.data||[],transfers:transfers.data||[],productionOrders:production.data||[]},cards:{networkOnHand:onHand,networkAvailable:onHand-reserved,projectedStockouts:stockout.length,openRisks:riskRows.filter((x:any)=>["open","monitoring"].includes(x.status)).length,pendingRecommendations:recRows.filter((x:any)=>["proposed","reviewed"].includes(x.status)).length,blockedOrQuarantinedLots:lotRows.filter((x:any)=>["blocked","quarantined"].includes(x.status)).length},permissions:[...c.permissions],scope:c.network?"network":"store",architecture:{inventoryLedger:"inventory_movements",currentBalance:"inventory_items.balance materialized by the official ledger",lots:"inventory_lots",procurement:"purchase_orders",transfers:"inventory_transfers",production:"production_orders",forecast:"forecast_predictions",readModels:["network_inventory_snapshots","fact_projected_inventory"],automaticExecution:false,noParallelLedgers:true}};
}

export async function GET(request:Request){try{const u=new URL(request.url),c=await context(String(u.searchParams.get("store_id")||""));requirePermission(c,"supply_chain:view");return reply(await load(c));}catch(error:any){const message=error?.message||"Falha ao carregar Supply Chain.";return reply({error:message},message==="AUTH"?401:message==="FORBIDDEN"?403:500)}}

export async function POST(request:Request){try{
  const b=await request.json(),c=await context(String(b.store_id||"")),action=String(b.action||"");
  if(action==="create_node"){
    requirePermission(c,"supply_chain:manage_sources");if(!b.human_confirmed)return reply({error:"Confirmação humana obrigatória."},409);
    const row={organization_id:c.organizationId,node_type:b.node_type,entity_type:b.entity_type,entity_id:b.entity_id||null,name:String(b.name||"").trim(),region_id:b.region_id||null,legal_entity_id:b.legal_entity_id||null,timezone:b.timezone||"America/Sao_Paulo",metadata:b.metadata||{}},{data,error}=await c.admin.from("supply_nodes").insert(row).select().single();if(error)throw error;await audit(c,"node_created","supply_node",data.id,b.reason,null,data);return reply({node:data},201);
  }
  if(action==="create_link"){
    requirePermission(c,"supply_chain:manage_sources");if(!b.human_confirmed)return reply({error:"Confirme a origem, o destino e a política de transferência."},409);
    const row={organization_id:c.organizationId,source_node_id:b.source_node_id,destination_node_id:b.destination_node_id,item_scope_type:b.item_scope_type||"all",item_scope_id:b.item_scope_id||null,priority:Number(b.priority||100),lead_time_profile_id:b.lead_time_profile_id||null,transport_profile_id:b.transport_profile_id||null,transfer_policy:b.transfer_policy||"internal_only"},{data,error}=await c.admin.from("supply_links").insert(row).select().single();if(error)throw error;await audit(c,"link_created","supply_link",data.id,b.reason,null,data);return reply({link:data},201);
  }
  if(action==="save_policy"){
    requirePermission(c,"supply_chain:manage_policies");if(!b.human_confirmed)return reply({error:"Revise e confirme a política."},409);
    const row={organization_id:c.organizationId,node_id:b.node_id,inventory_item_id:b.inventory_item_id||null,category_id:b.category_id||null,method:b.method||"reorder_point",min_qty:b.min_qty??null,max_qty:b.max_qty??null,reorder_point:b.reorder_point??null,target_cover_days:b.target_cover_days??null,transfer_before_buy:Boolean(b.transfer_before_buy),production_before_buy:Boolean(b.production_before_buy),allocation_policy:b.allocation_policy||"manual",created_by:c.userId};
    const{data,error}=b.id?await c.admin.from("replenishment_policies").update({...row,version:Number(b.version||1)+1,updated_at:new Date().toISOString()}).eq("id",b.id).eq("organization_id",c.organizationId).select().single():await c.admin.from("replenishment_policies").insert(row).select().single();if(error)throw error;await audit(c,"policy_saved","replenishment_policy",data.id,b.reason,null,data);return reply({policy:data});
  }
  if(action==="run_planning"){
    requirePermission(c,"supply_chain:simulate");if(!b.human_confirmed)return reply({error:"Confirme a execução do planejamento. Ela não movimenta estoque."},409);
    const horizonStart=new Date(),horizonEnd=new Date(horizonStart.getTime()+Math.min(90,Math.max(1,Number(b.horizon_days||14)))*86400000);
    const{data:run,error}=await c.admin.from("supply_planning_runs").insert({organization_id:c.organizationId,horizon_start:horizonStart.toISOString(),horizon_end:horizonEnd.toISOString(),scenario:b.scenario||"base",status:"queued",input_snapshot_version:`${Date.now()}`,input_snapshot:{source_tables:["inventory_movements","inventory_lots","purchase_orders","inventory_transfers","production_orders","forecast_predictions"]},partition_strategy:{region_category_criticality:true,max_items:500},created_by:c.userId}).select().single();if(error)throw error;
    const{data:items}=await c.admin.from("inventory_items").select("id,procurement_category,supply_criticality,establishment_id").eq("organization_id",c.organizationId).eq("active",true).eq("planning_enabled",true);const jobs=partitionPlanningJobs((items||[]).map((x:any)=>({itemId:x.id,categoryId:x.procurement_category||undefined,regionId:x.establishment_id,criticality:x.supply_criticality}))).map((x:any)=>({organization_id:c.organizationId,planning_run_id:run.id,partition_key:`${x.partition}:${x.index}`,priority:x.priority,payload:{item_ids:x.items.map((i:any)=>i.itemId)},idempotency_key:`${run.id}:${x.partition}:${x.index}`}));if(jobs.length){const{error:jobError}=await c.admin.from("supply_planning_jobs").insert(jobs);if(jobError)throw jobError;}await audit(c,"planning_run_queued","supply_planning_run",run.id,b.reason,null,{jobs:jobs.length,scenario:run.scenario});return reply({run,jobs:jobs.length,executed:false},202);
  }
  if(action==="review_recommendation"){
    requirePermission(c,"supply_chain:review_recommendations");if(!UUID.test(String(b.id||"")))return reply({error:"Recomendação inválida."},400);const{data:before}=await c.admin.from("supply_recommendations").select("*").eq("id",b.id).eq("organization_id",c.organizationId).maybeSingle();if(!before)return reply({error:"Recomendação não encontrada."},404);const next=b.decision==="reject"?"rejected":"reviewed";const{data,error}=await c.admin.from("supply_recommendations").update({status:next,reviewed_by:c.userId,reviewed_at:new Date().toISOString(),decision_reason:String(b.reason||"")}).eq("id",b.id).eq("organization_id",c.organizationId).select().single();if(error)throw error;await audit(c,`recommendation_${next}`,"supply_recommendation",data.id,b.reason,before,data);return reply({recommendation:data,executed:false});
  }
  if(action==="prepare_execution"){
    requirePermission(c,"supply_chain:approve_recommendations");if(!b.human_confirmed)return reply({error:"Aprovação humana obrigatória antes de preparar um rascunho."},409);const{data:recommendation}=await c.admin.from("supply_recommendations").select("*").eq("id",b.id).eq("organization_id",c.organizationId).maybeSingle();if(!recommendation)return reply({error:"Recomendação não encontrada."},404);const validation=new SupplyRecommendationExecutionService().revalidate({status:recommendation.status,expiresAt:recommendation.expires_at,originalFingerprint:recommendation.input_fingerprint,currentFingerprint:String(b.current_fingerprint||""),lotStatus:b.lot_status,remainingShelfLifeHours:b.remaining_shelf_life_hours,requiredTransitHours:b.required_transit_hours,available:Number(b.available||0),quantity:Number(recommendation.quantity||0)});if(!validation.valid)return reply({error:"Recomendação desatualizada ou inviável.",validation},409);const target=recommendation.recommendation_type==="purchase"?{route:"/api/procurement-intelligence",action:"create_purchase_order_draft"}:recommendation.recommendation_type==="production"?{route:"/api/central-production",action:"create_order"}:{route:"/api/central-production",action:"create_transfer"};await c.admin.from("supply_recommendations").update({status:"approved",reviewed_by:c.userId,reviewed_at:new Date().toISOString(),revalidation_snapshot:validation}).eq("id",recommendation.id);await audit(c,"recommendation_execution_prepared","supply_recommendation",recommendation.id,b.reason,recommendation,{target,validation});return reply({bridge:target,payload:{recommendation_id:recommendation.id,inventory_item_id:recommendation.inventory_item_id,source_node_id:recommendation.source_node_id,destination_node_id:recommendation.destination_node_id,quantity:recommendation.quantity},draftOnly:true,automaticExecution:false,validation});
  }
  if(action==="simulate_scenario"){
    requirePermission(c,"supply_chain:simulate");const simulation=new SupplyScenarioService().simulate(Array.isArray(b.base)?b.base:[],b.scenario||{type:"base"});return reply({simulation,executed:false});
  }
  return reply({error:"Ação inválida."},400);
}catch(error:any){const message=error?.message||"Falha na operação de Supply Chain.";return reply({error:message},message==="AUTH"?401:message==="FORBIDDEN"?403:500)}}
