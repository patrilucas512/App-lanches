export const KITCHEN_PERMISSIONS=["kitchen:view","kitchen:operate","kitchen:prioritize","kitchen:manage_stations","kitchen:manage_capacity","kitchen:analytics","kitchen:expedition"] as const;
export type KitchenTaskStatus="queued"|"waiting_dependency"|"ready_to_start"|"in_progress"|"paused"|"completed"|"cancelled"|"exception";
export type KitchenTask={id:string;orderId:string;orderItemId?:string;stationId:string;status:KitchenTaskStatus;queuedAt:string;promisedAt?:string;estimatedDuration:number;manualPriority?:"normal"|"high"|"urgent";dependenciesComplete?:boolean;stationLoad?:number;channel?:string;qualityMaxHoldMinutes?:number;completedAt?:string};
const n=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0;
const minutes=(from:string,to=new Date().toISOString())=>Math.max(0,(Date.parse(to)-Date.parse(from))/60000);

export class KitchenQueueService{
  score(task:KitchenTask,now=new Date().toISOString()){
    const age=Math.min(40,minutes(task.queuedAt,now));
    const promise=task.promisedAt?Math.max(-10,30-minutes(now,task.promisedAt)):0;
    const duration=Math.min(20,n(task.estimatedDuration));
    const priority=task.manualPriority==="urgent"?50:task.manualPriority==="high"?25:0;
    const dependency=task.dependenciesComplete===false?-100:10;
    const load=Math.max(-15,10-n(task.stationLoad)/10);
    const channel=task.channel==="delivery"?5:task.channel==="dine_in"?3:0;
    const score=Math.round(age+promise+duration+priority+dependency+load+channel);
    return{score,factors:{age,promised_time:promise,duration,manual_priority:priority,dependency,station_load:load,channel},explanation:[age>15?"pedido antigo":null,promise>20?"próximo da promessa":null,duration>10?"item de preparo longo":null,priority?`prioridade ${task.manualPriority}`:null,dependency<0?"aguarda dependência":null].filter(Boolean)};
  }
  order(tasks:KitchenTask[],now?:string){return tasks.map(task=>({...task,...this.score(task,now)})).sort((a,b)=>b.score-a.score||Date.parse(a.queuedAt)-Date.parse(b.queuedAt));}
  safeFallback(tasks:KitchenTask[]){return [...tasks].sort((a,b)=>Number(a.dependenciesComplete===false)-Number(b.dependenciesComplete===false)||Date.parse(a.queuedAt)-Date.parse(b.queuedAt));}
}

export class KitchenSynchronizationService{
  plan(items:Array<{id:string;duration:number;maxHoldMinutes:number}>,targetReadyAt:string,toleranceMinutes=3,now=new Date().toISOString()){
    const target=Date.parse(targetReadyAt),base=Date.parse(now);
    return items.map(item=>{const latest=target-n(item.duration)*60000;const qualityFloor=target-n(item.maxHoldMinutes)*60000;const fire=Math.max(base,Math.min(latest,qualityFloor));return{id:item.id,fireAt:new Date(fire).toISOString(),estimatedReadyAt:new Date(fire+n(item.duration)*60000).toISOString(),toleranceMinutes,qualityGuardrail:true};});
  }
}

export class KitchenBatchingService{
  evaluate(tasks:Array<KitchenTask&{productId?:string;variantId?:string}>,capacity:number,windowMinutes=8){const ready=tasks.filter(x=>x.dependenciesComplete!==false&&!["completed","cancelled"].includes(x.status));if(!ready.length)return{allowed:false,reasons:["sem tarefas elegíveis"],tasks:[]};const first=ready[0],same=ready.filter(x=>x.stationId===first.stationId&&x.productId===first.productId&&x.variantId===first.variantId&&Math.abs(minutes(first.queuedAt,x.queuedAt))<=windowMinutes).slice(0,Math.max(1,capacity));const critical=same.some(x=>this.isCritical(x));return{allowed:same.length>1&&!critical,reasons:same.length<2?["sem oportunidade de lote"]:critical?["pedido crítico não pode atrasar"]:[],tasks:same,quantity:same.length,automatic:false};}
  private isCritical(task:KitchenTask){return task.manualPriority==="urgent"||(task.promisedAt?minutes(new Date().toISOString(),task.promisedAt)<5:false);}
}

export class KitchenCapacityService{
  calculate(input:{activeTasks:number;concurrentTasks?:number;itemsPerHour?:number;equipmentCapacity?:number;averageMinutes?:number}){const configured=Math.max(1,n(input.concurrentTasks)||n(input.equipmentCapacity)||Math.ceil(n(input.itemsPerHour)*Math.max(1,n(input.averageMinutes))/60)||1),load=Math.round(n(input.activeTasks)/configured*100);return{currentLoad:n(input.activeTasks),availableCapacity:Math.max(0,configured-n(input.activeTasks)),capacity:configured,utilizationPercent:load,estimatedClearMinutes:Math.ceil(n(input.activeTasks)*Math.max(1,n(input.averageMinutes))/configured),risk:load>=90?"high":load>=70?"medium":"low"};}
}

export class ExpeditionService{
  evaluate(tasks:KitchenTask[],checklistRequired=false,checks:Record<string,boolean>={}){const active=tasks.filter(x=>x.status!=="cancelled"),completed=active.filter(x=>x.status==="completed").length,missing=active.filter(x=>x.status!=="completed");const checklistOk=!checklistRequired||Object.values(checks).length>0&&Object.values(checks).every(Boolean);return{allItemsReady:active.length>0&&completed===active.length,partialReady:completed>0&&completed<active.length,missingTaskIds:missing.map(x=>x.id),checklistOk,canComplete:active.length>0&&completed===active.length&&checklistOk};}
}

export function releaseDependencies(tasks:Array<KitchenTask&{dependencyTaskIds?:string[]}>,completedId:string){const completed=new Set(tasks.filter(x=>x.status==="completed").map(x=>x.id).concat(completedId));return tasks.map(task=>task.status==="waiting_dependency"&&(task.dependencyTaskIds||[]).every(id=>completed.has(id))?{...task,status:"ready_to_start" as const,dependenciesComplete:true}:task);}
export function validateProductionSteps(steps:Array<{id:string;dependencyStepId?:string|null}>){const map=new Map(steps.map(x=>[x.id,x.dependencyStepId||null]));for(const step of steps){const seen=new Set<string>();let cursor:string|null=step.id;while(cursor){if(seen.has(cursor))return{valid:false,error:"Dependência cíclica detectada.",stepId:step.id};seen.add(cursor);cursor=map.get(cursor)||null;}}return{valid:true};}
export function chooseCompatibleStation(input:{primaryId:string;secondaryIds:string[];loads:Record<string,number>;compatibleIds:string[];autoBalance:boolean}){const allowed=[input.primaryId,...input.secondaryIds].filter(x=>input.compatibleIds.includes(x));if(!input.autoBalance||!allowed.length)return{stationId:input.primaryId,reason:"roteamento padrão",automatic:false};const stationId=allowed.sort((a,b)=>n(input.loads[a])-n(input.loads[b]))[0];return{stationId,reason:stationId===input.primaryId?"estação primária disponível":`${input.primaryId} acima da carga; ${stationId} é compatível`,automatic:stationId!==input.primaryId};}
export function predictedDelayRisk(input:{backlog:number;capacity:number;prepMinutes:number;promiseMinutes:number}){const projected=n(input.prepMinutes)+Math.max(0,n(input.backlog)-n(input.capacity))*Math.max(1,n(input.prepMinutes))/Math.max(1,n(input.capacity));return{level:projected>n(input.promiseMinutes)*1.2?"high":projected>n(input.promiseMinutes)*.9?"medium":"low",projectedMinutes:Math.ceil(projected),falsePrecision:false};}
export function kitchenCopilot(tool:string,context:any){const tasks=context.tasks||[],stations=context.stations||[];switch(tool){case"getKitchenStatus":return{active:tasks.filter((x:any)=>!["completed","cancelled"].includes(x.status)).length,completed:tasks.filter((x:any)=>x.status==="completed").length};case"getKitchenBacklog":return new KitchenQueueService().order(tasks);case"getStationLoad":case"getKitchenCapacity":return stations.map((s:any)=>({...s,...new KitchenCapacityService().calculate(s)}));case"getDelayedOrders":return tasks.filter((x:any)=>x.promisedAt&&Date.parse(x.promisedAt)<Date.now()&&x.status!=="completed");case"getBottleneckStations":return stations.map((s:any)=>({...s,...new KitchenCapacityService().calculate(s)})).filter((x:any)=>x.risk!=="low").sort((a:any,b:any)=>b.utilizationPercent-a.utilizationPercent);case"getPreparationForecast":return context.forecast||[];case"getExpeditionStatus":return new ExpeditionService().evaluate(tasks,context.checklistRequired,context.checks);default:throw new Error("Ferramenta de cozinha não suportada.");}}
export const KITCHEN_ACTIONS={reprioritize_order:{confirmation:true},move_task:{confirmation:true,compatibleStationRequired:true},pause_station:{confirmation:true},mark_equipment_unavailable:{confirmation:true},toggle_product_availability:{confirmation:true},create_batch:{confirmation:true},increase_channel_eta:{confirmation:true}} as const;
