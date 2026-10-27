export const CENTRAL_PRODUCTION_PERMISSIONS=[
  "central_production:view","central_production:plan","central_production:create_order","central_production:release_order",
  "central_production:complete_order","central_production:view_cost","central_production:manage_requisitions","central_production:allocate",
  "central_production:manage_transfers","central_production:dispatch","central_production:receive","central_production:manage_discrepancies",
  "central_production:view_network","central_production:manage_settings"
] as const;

export const CENTRAL_PRODUCTION_FLAGS=["central_production_enabled","internal_requisitions_enabled","interstore_transfers_enabled","production_batch_traceability_enabled","production_planning_enabled"] as const;
export const CENTRAL_PRODUCTION_COPILOT_TOOLS=["getProductionPlan","getProductionOrders","getStoreRequisitions","getProductionMaterialShortages","getBatchTraceability","getTransfersInTransit","getTransferDiscrepancies","getProductionYield","getCentralStock","simulateProductionScenario"] as const;
export const PRODUCTION_ORDER_STATUSES=["draft","planned","released","in_progress","paused","completed","cancelled","partially_completed"] as const;
export const TRANSFER_STATUSES=["draft","approved","picking","packed","dispatched","in_transit","partially_received","received","cancelled","discrepancy_review"] as const;
export const REQUISITION_STATUSES=["draft","submitted","approved","partially_allocated","allocated","fulfilled","cancelled"] as const;
export const WASTE_REASONS=["trim","process_loss","quality_reject","spill","overproduction","expiration","other"] as const;

const n=(value:unknown)=>Number.isFinite(Number(value))?Number(value):0;
const round=(value:number,scale=4)=>Number(value.toFixed(scale));

export type BatchPolicy={minBatch:number;standardBatch:number;maxBatch:number;roundingRule:"up"|"nearest"|"down"};
export class ProductionBatchPolicyService{
  round(quantity:number,policy:BatchPolicy){
    if(quantity<=0)return 0;
    const size=Math.max(.0001,n(policy.standardBatch));
    const ratio=quantity/size;
    const batches=policy.roundingRule==="down"?Math.floor(ratio):policy.roundingRule==="nearest"?Math.round(ratio):Math.ceil(ratio);
    return round(Math.min(Math.max(Math.max(1,batches)*size,n(policy.minBatch)),n(policy.maxBatch)||Number.MAX_SAFE_INTEGER));
  }
}

export type PlanningDemand={itemId:string;storeId:string;quantity:number;requiredAt:string;priority?:number;source:"requisition"|"forecast"|"replenishment"|"campaign"|"opening_stock"};
export class ProductionPlanningService{
  suggest(input:{demands:PlanningDemand[];centralStock:Record<string,number>;inbound?:Record<string,number>;bufferPercent?:Record<string,number>;policies:Record<string,BatchPolicy>;capacity:Record<string,number>;shelfLifeDemandCap?:Record<string,number>}){
    const grouped=new Map<string,PlanningDemand[]>();
    for(const demand of input.demands)(grouped.get(demand.itemId)||grouped.set(demand.itemId,[]).get(demand.itemId)!).push(demand);
    return [...grouped].map(([itemId,demands])=>{
      const requested=demands.reduce((sum,d)=>sum+n(d.quantity),0),available=n(input.centralStock[itemId])+n(input.inbound?.[itemId]);
      const shortfall=Math.max(0,requested-available),buffer=shortfall*n(input.bufferPercent?.[itemId])/100;
      const safeNeed=Math.min(shortfall+buffer,n(input.shelfLifeDemandCap?.[itemId])||Number.MAX_SAFE_INTEGER);
      const suggested=new ProductionBatchPolicyService().round(safeNeed,input.policies[itemId]||{minBatch:0,standardBatch:1,maxBatch:Number.MAX_SAFE_INTEGER,roundingRule:"up"});
      const capacity=n(input.capacity[itemId])||Number.MAX_SAFE_INTEGER;
      return{itemId,requested:round(requested),available:round(available),suggestedQuantity:round(Math.min(suggested,capacity)),unmetDemand:round(Math.max(0,suggested-capacity)),capacityExceeded:suggested>capacity,confidence:demands.some(d=>d.source==="forecast")?"medium":"high",reasons:["demanda consolidada",available?"estoque central e entradas considerados":"sem cobertura central",buffer?"buffer configurado aplicado":"sem buffer cego",suggested!==safeNeed?"arredondado pela política de lote":"quantidade líquida"]};
    });
  }
}

export type AllocationLine={storeId:string;requisitionItemId?:string;requested:number;priority?:number;approvedAt?:string;minimumGuarantee?:number};
export class ProductionAllocationService{
  allocate(available:number,lines:AllocationLine[],policy:"proportional"|"priority_store"|"first_approved"|"manual"|"minimum_guarantee",manual:Record<string,number>={}){
    const stock=Math.max(0,n(available)),result=new Map(lines.map(line=>[line.storeId,0]));
    if(policy==="manual")for(const line of lines)result.set(line.storeId,Math.min(n(line.requested),n(manual[line.storeId])));
    else if(policy==="proportional"){
      const total=lines.reduce((sum,line)=>sum+n(line.requested),0);for(const line of lines)result.set(line.storeId,round(Math.min(n(line.requested),total?stock*n(line.requested)/total:0)));
    }else if(policy==="minimum_guarantee"){
      let left=stock;for(const line of lines){const give=Math.min(left,n(line.requested),n(line.minimumGuarantee));result.set(line.storeId,give);left-=give}const pending=lines.filter(l=>n(l.requested)>n(result.get(l.storeId)));const pendingTotal=pending.reduce((s,l)=>s+n(l.requested)-n(result.get(l.storeId)),0);for(const line of pending){const extra=Math.min(n(line.requested)-n(result.get(line.storeId)),pendingTotal?left*(n(line.requested)-n(result.get(line.storeId)))/pendingTotal:0);result.set(line.storeId,round(n(result.get(line.storeId))+extra));}
    }else{
      const sorted=[...lines].sort((a,b)=>policy==="priority_store"?n(b.priority)-n(a.priority):String(a.approvedAt||"").localeCompare(String(b.approvedAt||"")));let left=stock;for(const line of sorted){const give=Math.min(left,n(line.requested));result.set(line.storeId,give);left-=give;}
    }
    return lines.map(line=>({storeId:line.storeId,requisitionItemId:line.requisitionItemId,requested:round(n(line.requested)),allocated:round(n(result.get(line.storeId))),shortfall:round(Math.max(0,n(line.requested)-n(result.get(line.storeId))))}));
  }
}

export type RecipeInput={itemId:string;quantity:number;conversionFactor?:number;wastePercent?:number};
export class MaterialRequirementService{
  calculate(plannedOutput:number,expectedYield:number,inputs:RecipeInput[]){const factor=n(plannedOutput)/Math.max(.0001,n(expectedYield));return inputs.map(input=>({itemId:input.itemId,requiredQuantity:round(n(input.quantity)*factor*n(input.conversionFactor||1)*(1+n(input.wastePercent)/100))}));}
  availability(requirements:{itemId:string;requiredQuantity:number}[],stock:Record<string,number>,reserved:Record<string,number>={},inbound:Record<string,number>={}){return requirements.map(r=>{const available=Math.max(0,n(stock[r.itemId])-n(reserved[r.itemId])),shortage=Math.max(0,n(r.requiredQuantity)-available-n(inbound[r.itemId]));return{...r,available:round(available),inbound:round(n(inbound[r.itemId])),shortage:round(shortage),ready:shortage===0}})}
}

export type LotCandidate={id:string;status:string;quantityAvailable:number;expiresAt?:string|null};
export class LotSelectionService{
  selectFefo(lots:LotCandidate[],quantity:number,arrivalAt?:string,safetyHours=0){let left=n(quantity);const cutoff=arrivalAt?Date.parse(arrivalAt)+safetyHours*3600000:0;const selected=[] as {lotId:string;quantity:number}[];for(const lot of [...lots].filter(l=>["active","released"].includes(l.status)&&n(l.quantityAvailable)>0&&(!cutoff||!l.expiresAt||Date.parse(l.expiresAt)>cutoff)).sort((a,b)=>Date.parse(a.expiresAt||"9999-12-31")-Date.parse(b.expiresAt||"9999-12-31"))){const take=Math.min(left,n(lot.quantityAvailable));if(take>0)selected.push({lotId:lot.id,quantity:round(take)});left-=take;if(left<=0)break}return{selected,shortage:round(Math.max(0,left)),blocked:left>0};}
}

export class ProductionShelfLifeService{
  expiresAt(producedAt:string,config:{shelfLifeHours?:number;shelfLifeDays?:number}){const ms=(n(config.shelfLifeHours)+n(config.shelfLifeDays)*24)*3600000;if(ms<=0)return null;return new Date(Date.parse(producedAt)+ms).toISOString()}
  transferFeasibility(expiresAt:string|undefined,expectedArrivalAt:string,safetyHours=0,mode:"block"|"warn"="warn"){if(!expiresAt)return{feasible:true,severity:"none"};const risky=Date.parse(expectedArrivalAt)+safetyHours*3600000>=Date.parse(expiresAt);return{feasible:!risky||mode==="warn",severity:risky?mode:"none",reason:risky?"arrival_outside_expiry_safety_window":null}}
}

export class ProductionYieldService{calculate(expected:number,actual:number,waste=0){const variance=n(actual)-n(expected),rate=n(expected)?n(actual)/n(expected)*100:0;return{expected:round(n(expected)),actual:round(n(actual)),variance:round(variance),yieldPercent:round(rate,2),waste:round(n(waste)),wasteRate:round(n(expected)?n(waste)/n(expected)*100:0,2)}}}
export class ProductionCostService{snapshot(input:{materialCents:number;packagingCents?:number;directLaborEstimateCents?:number;overheadEstimateCents?:number;actualQuantity:number}){const total=Math.round(n(input.materialCents)+n(input.packagingCents)+n(input.directLaborEstimateCents)+n(input.overheadEstimateCents));return Object.freeze({materialCents:Math.round(n(input.materialCents)),packagingCents:Math.round(n(input.packagingCents)),directLaborEstimateCents:Math.round(n(input.directLaborEstimateCents)),overheadEstimateCents:Math.round(n(input.overheadEstimateCents)),totalCents:total,costPerUnitCents:n(input.actualQuantity)>0?round(total/n(input.actualQuantity),4):0,method:"weighted_material_plus_configured_addons",immutable:true})}}

export function assertRecipeAcyclic(edges:{outputItemId:string;inputItemId:string}[]){const graph=new Map<string,string[]>();for(const edge of edges)(graph.get(edge.outputItemId)||graph.set(edge.outputItemId,[]).get(edge.outputItemId)!).push(edge.inputItemId);const visiting=new Set<string>(),done=new Set<string>();const walk=(id:string)=>{if(visiting.has(id))throw new Error("recipe_cycle_detected");if(done.has(id))return;visiting.add(id);for(const next of graph.get(id)||[])walk(next);visiting.delete(id);done.add(id)};for(const id of graph.keys())walk(id);return true;}

export class ProductionScenarioService{
  simulate(input:{requested:number;materialCapacity:number;productionCapacity:number;transferCapacity?:number;sellableBeforeExpiry?:number}){const feasible=Math.min(n(input.requested),n(input.materialCapacity),n(input.productionCapacity),n(input.transferCapacity)||Number.MAX_SAFE_INTEGER,n(input.sellableBeforeExpiry)||Number.MAX_SAFE_INTEGER);return{dryRun:true,requested:round(n(input.requested)),feasibleQuantity:round(feasible),unmetDemand:round(Math.max(0,n(input.requested)-feasible)),materialShortage:round(Math.max(0,n(input.requested)-n(input.materialCapacity))),capacityShortage:round(Math.max(0,n(input.requested)-n(input.productionCapacity))),expiryExcessRisk:n(input.sellableBeforeExpiry)>0&&n(input.requested)>n(input.sellableBeforeExpiry),executed:false}}
}

