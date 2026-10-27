export const CAPACITY_PERMISSIONS=["capacity:view","capacity:view_future","capacity:manage_models","capacity:manage_slots","capacity:manage_overrides","capacity:manage_policies","capacity:pause_channels","capacity:simulate","capacity:view_network"] as const;
export const CAPACITY_COPILOT_TOOLS=["getCurrentCapacity","getCapacityByResource","getFutureCapacity","getAvailableOrderSlots","getOrdersAtRisk","getQueueHealth","getCapacityOverrides","simulateCapacityScenario"] as const;
export type Confidence="high"|"medium"|"low";
export type QueueHealth="normal"|"busy"|"saturated"|"overloaded"|"recovering";
const n=(value:unknown)=>Number.isFinite(Number(value))?Number(value):0;
const clamp=(value:number,min=0,max=Number.POSITIVE_INFINITY)=>Math.min(max,Math.max(min,value));

export type CapacityInput={baseCapacity:number;windowOverride?:number|null;workforceCoverage?:number;stationAvailability?:number;assetAvailability?:number;temporaryAdjustmentPercent?:number;currentWorkload?:number;scheduledWorkload?:number;reservationWorkload?:number;deliveryWorkload?:number;confidence?:Confidence};
export class EffectiveCapacityService{
  calculate(input:CapacityInput){
    const base=Math.max(0,n(input.windowOverride??input.baseCapacity));
    const factors={workforce:clamp(n(input.workforceCoverage??1),0,1.5),stations:clamp(n(input.stationAvailability??1),0,1),assets:clamp(n(input.assetAvailability??1),0,1),override:clamp(1+n(input.temporaryAdjustmentPercent)/100,0,2)};
    const effective=Math.max(0,Math.round(base*factors.workforce*factors.stations*factors.assets*factors.override*100)/100);
    const demand=Math.max(0,n(input.currentWorkload))+Math.max(0,n(input.scheduledWorkload))+Math.max(0,n(input.reservationWorkload))+Math.max(0,n(input.deliveryWorkload));
    const available=Math.max(0,effective-demand),utilization=effective>0?demand/effective: demand>0?1:0;
    const limitingFactors=[factors.workforce<1?`equipe ${Math.round(factors.workforce*100)}%`:null,factors.stations<1?"estação indisponível":null,factors.assets<1?"ativo operacional indisponível":null,factors.override<1?`override ${Math.round((factors.override-1)*100)}%`:null,demand>effective?"carga acima da capacidade":null].filter(Boolean);
    return{baseCapacity:base,effectiveCapacity:effective,availableCapacity:available,currentDemand:demand,utilization,utilizationPercent:Math.round(utilization*100),confidence:input.confidence||"medium",limitingFactors,explanation:limitingFactors.length?`Capacidade ajustada: ${limitingFactors.join("; ")}.`:"Capacidade operacional sem restrições relevantes."};
  }
}

export type WorkloadItem={productId:string;quantity:number;workloadUnits?:number;comboComponents?:Array<{quantity:number;workloadUnits:number}>;hasOwnComboProfile?:boolean;batchable?:boolean;maxBatchSize?:number|null};
export class DemandLoadService{
  orderWorkload(items:WorkloadItem[]){return items.reduce((total,item)=>{const quantity=Math.max(0,n(item.quantity));let units=n(item.workloadUnits);if(item.comboComponents?.length&&!item.hasOwnComboProfile)units=item.comboComponents.reduce((sum,c)=>sum+n(c.quantity)*n(c.workloadUnits),0);if(item.batchable&&n(item.maxBatchSize)>1)units=units/Math.min(quantity||1,n(item.maxBatchSize));return total+quantity*units;},0)}
  combine(input:{current:number;scheduled?:number;reservations?:number;forecast?:number;forecastConfidence?:Confidence}){const forecastWeight=input.forecastConfidence==="high"?.7:input.forecastConfidence==="medium"?.4:.15;const committed=n(input.current)+n(input.scheduled)+n(input.reservations);return{committed,forecastWeighted:n(input.forecast)*forecastWeight,total:committed+n(input.forecast)*forecastWeight,forecastWeight,blockingDemand:committed};}
}

export class OperationalQueueService{
  measure(items:Array<{workload:number;queuedAt:string;promisedAt?:string|null;status?:string}>,effectiveCapacity:number,busy=.65,saturated=.85,overloaded=1.05,now=new Date()){
    const active=items.filter(x=>!["completed","cancelled"].includes(String(x.status))),workload=active.reduce((sum,x)=>sum+n(x.workload),0),utilization=effectiveCapacity>0?workload/effectiveCapacity:workload?1:0,oldest=active.length?Math.max(...active.map(x=>Math.max(0,(now.getTime()-Date.parse(x.queuedAt))/60000))):0,delayed=active.filter(x=>x.promisedAt&&Date.parse(x.promisedAt)<now.getTime()).length;
    const health:QueueHealth=utilization>=overloaded?"overloaded":utilization>=saturated?"saturated":utilization>=busy?"busy":"normal";
    return{queueLength:active.length,workload,utilization,oldestItemAgeMinutes:Math.round(oldest),estimatedClearMinutes:effectiveCapacity>0?Math.ceil(workload/effectiveCapacity*60):null,delayedCount:delayed,health};
  }
}

export type CapacitySlot={id:string;startsAt:string;endsAt:string;capacityTotal:number;capacityReserved:number;capacityCommitted:number;status:"open"|"limited"|"full"|"closed"|"blocked";version:number};
export class CapacitySlotService{
  availability(slot:CapacitySlot){const available=Math.max(0,n(slot.capacityTotal)-n(slot.capacityReserved)-n(slot.capacityCommitted));return{...slot,capacityAvailable:available,status:slot.status==="closed"||slot.status==="blocked"?slot.status:available<=0?"full":available<slot.capacityTotal*.2?"limited":"open"};}
  canReserve(slot:CapacitySlot,workload:number){const state=this.availability(slot);return{allowed:state.status!=="closed"&&state.status!=="blocked"&&state.capacityAvailable>=n(workload),available:state.capacityAvailable,requiresAtomicCommit:true};}
  nextAlternative(slots:CapacitySlot[],workload:number){return slots.map(s=>this.availability(s)).find(s=>s.status==="open"&&s.capacityAvailable>=n(workload))||null;}
  expireHolds<T extends{expiresAt:string;status:string}>(holds:T[],now=new Date()){return holds.map(hold=>hold.status==="active"&&Date.parse(hold.expiresAt)<=now.getTime()?{...hold,status:"expired"}:hold);}
}

export class OrderPromiseService{
  calculate(input:{fulfillment:"pickup"|"delivery"|"dine_in"|"scheduled";prepMin:number;prepMax?:number;expeditionMin?:number;dispatchMin?:number;travelMin?:number;bufferMin?:number;queueDelayMin?:number;confidence?:Confidence;requestedAt?:string}){
    const confidence=input.confidence||"medium",prepMin=Math.max(0,n(input.prepMin)),prepMax=Math.max(prepMin,n(input.prepMax??prepMin)),expedition=Math.max(0,n(input.expeditionMin)),dispatch=input.fulfillment==="delivery"?Math.max(0,n(input.dispatchMin)):0,travel=input.fulfillment==="delivery"?Math.max(0,n(input.travelMin)):0,queue=Math.max(0,n(input.queueDelayMin)),buffer=Math.max(0,n(input.bufferMin))+(confidence==="low"?10:confidence==="medium"?5:0),minimum=Math.ceil(prepMin+expedition+dispatch+travel+queue),maximum=Math.ceil(prepMax+expedition+dispatch+travel+queue+buffer),anchor=new Date(input.requestedAt||Date.now());
    const from=new Date(anchor.getTime()+minimum*60000).toISOString(),to=new Date(anchor.getTime()+Math.max(minimum,maximum)*60000).toISOString();
    return{minimumMinutes:minimum,maximumMinutes:Math.max(minimum,maximum),window:{from,to},label:`${minimum}–${Math.max(minimum,maximum)} min`,confidence,exact:false,components:{preparation:[prepMin,prepMax],expedition,dispatch,travel,queue,buffer},originalPromiseImmutable:true};
  }
}

export class ChannelThrottleService{
  evaluate(input:{utilization:number;threshold:number;durationMinutes:number;observedMinutes:number;recoveryThreshold:number;belowRecoveryMinutes?:number;recoveryDurationMinutes?:number;cooldownActive?:boolean;explicitPolicy?:boolean;action?:string;currentState?:"normal"|"throttled"|"recovering"}){
    if(!input.explicitPolicy)return{action:"notify_only",state:"normal",applied:false,reason:"automatic policy disabled"};
    if(input.currentState==="throttled"&&input.utilization<=input.recoveryThreshold&&n(input.belowRecoveryMinutes)>=n(input.recoveryDurationMinutes||10))return{action:"gradual_reopen",state:"recovering",applied:true,reason:"recovery hysteresis satisfied"};
    if(input.cooldownActive)return{action:"notify_only",state:input.currentState||"normal",applied:false,reason:"cooldown active"};
    if(input.utilization>=input.threshold&&input.observedMinutes>=input.durationMinutes)return{action:input.action||"extend_eta",state:"throttled",applied:true,reason:"threshold duration satisfied"};
    return{action:"notify_only",state:input.currentState||"normal",applied:false,reason:"brief spike ignored"};
  }
  preferredAction(level:number){return level<.85?"notify_only":level<.95?"extend_eta":level<1.05?"limit_slots":level<1.2?"restrict_large_orders":"pause_channel";}
}

export class CapacityRecoveryService{
  plan(input:{backlogRatio:number;queueAgeMinutes:number;staffingCoverage:number;resourceHealth:number;wasAutoThrottled:boolean}){const safe=input.backlogRatio<.65&&input.queueAgeMinutes<10&&input.staffingCoverage>=.8&&input.resourceHealth>=.8;return{state:safe?"recovering":"overloaded",steps:safe?["reduce_eta_gradually","reopen_future_slots","reopen_channel_last"]:[],automatic:safe&&input.wasAutoThrottled,immediateFullReopen:false};}
}

export class OrderRiskService{
  evaluate(input:{minutesToPromise:number;remainingProductionMinutes:number;queueBacklogMinutes:number;deliveryWaitMinutes?:number}){const gap=n(input.remainingProductionMinutes)+n(input.queueBacklogMinutes)+n(input.deliveryWaitMinutes)-n(input.minutesToPromise),level=gap>15?"high":gap>0?"medium":"low";return{level,late:false,projectedGapMinutes:Math.ceil(gap),reasons:[input.queueBacklogMinutes>input.minutesToPromise?`${input.queueBacklogMinutes} min de backlog`:null,input.remainingProductionMinutes>input.minutesToPromise?"produção restante acima da janela":null,n(input.deliveryWaitMinutes)>10?"espera de entrega elevada":null].filter(Boolean)};}
}

export class CapacityForecastService{
  project(slots:Array<{startsAt:string;capacity:number;committed:number;scheduled?:number;reservations?:number;forecast?:number;forecastConfidence?:Confidence}>){return slots.map(slot=>{const demand=new DemandLoadService().combine({current:slot.committed,scheduled:slot.scheduled,reservations:slot.reservations,forecast:slot.forecast,forecastConfidence:slot.forecastConfidence});const utilization=slot.capacity>0?demand.total/slot.capacity:1;return{startsAt:slot.startsAt,projectedUtilization:utilization,projectedPercent:Math.round(utilization*100),label:"Projected",confidence:slot.forecastConfidence||"low",certain:false};});}
}

export class CapacitySimulationService{
  simulate(input:{currentDemand:number;capacity:number;demandChangePercent:number;staffingChangePercent?:number}){const demand=n(input.currentDemand)*(1+n(input.demandChangePercent)/100),capacity=n(input.capacity)*(1+n(input.staffingChangePercent)/100),utilization=capacity>0?demand/capacity:1;return{projectedDemand:demand,projectedCapacity:capacity,projectedUtilization:utilization,projectedQueue:Math.max(0,demand-capacity),additionalStaffingSignal:utilization>1?Math.ceil((demand-capacity)/Math.max(1,capacity/Math.max(1,100))):0,dryRun:true,mutatedOperation:false};}
}

export class CapacityFallbackPolicy{
  resolve(input:{engineAvailable:boolean;channel:string;lastPublishedSlots?:boolean;inStore?:boolean}){if(input.engineAvailable)return{mode:"live",allow:true,scheduledOrders:true};if(input.inStore)return{mode:"allow_instore_only",allow:true,scheduledOrders:false,eta:"static"};if(input.lastPublishedSlots)return{mode:"keep_last_published_slots",allow:true,scheduledOrders:false,eta:"conservative"};return{mode:"use_static_eta",allow:true,scheduledOrders:false,eta:"conservative"};}
}

export class CapacityQueryService{
  private readonly snapshot:{resources?:unknown[];future?:unknown[];slots?:CapacitySlot[];queues?:unknown[];risks?:unknown[];overrides?:unknown[]};
  constructor(snapshot:{resources?:unknown[];future?:unknown[];slots?:CapacitySlot[];queues?:unknown[];risks?:unknown[];overrides?:unknown[]}={}){this.snapshot=snapshot}
  getCurrentCapacity(){return this.snapshot.resources||[]}
  getFutureCapacity(){return this.snapshot.future||[]}
  getAvailableSlots(workload=0){return (this.snapshot.slots||[]).map(s=>new CapacitySlotService().availability(s)).filter(s=>s.capacityAvailable>=workload&&!["closed","blocked","full"].includes(s.status))}
  getPromise(input:Parameters<OrderPromiseService["calculate"]>[0]){return new OrderPromiseService().calculate(input)}
  getResourceHealth(){return{resources:this.snapshot.resources||[],queues:this.snapshot.queues||[]}}
  getOrderRisk(){return this.snapshot.risks||[]}
  getCapacityOverrides(){return this.snapshot.overrides||[]}
  simulateDemand(input:Parameters<CapacitySimulationService["simulate"]>[0]){return new CapacitySimulationService().simulate(input)}
}
