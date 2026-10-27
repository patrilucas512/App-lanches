/* eslint-disable @typescript-eslint/no-explicit-any */
export type WorkTask={id:string;title:string;status:string;priority?:string;assigned_to_user_id?:string|null;due_at?:string|null;estimate_hours?:number|null;team_id?:string|null;source_type?:string|null;task_type?:string;severity?:string|null;created_at?:string};
export type Dependency={task_id:string;depends_on_task_id:string};

export function wouldCreateDependencyCycle(edges:Dependency[],taskId:string,dependsOnId:string){
  if(taskId===dependsOnId)return true;
  const graph=new Map<string,string[]>();
  for(const edge of edges)graph.set(edge.task_id,[...(graph.get(edge.task_id)||[]),edge.depends_on_task_id]);
  graph.set(taskId,[...(graph.get(taskId)||[]),dependsOnId]);
  const seen=new Set<string>(),stack=new Set<string>();
  const visit=(id:string):boolean=>{if(stack.has(id))return true;if(seen.has(id))return false;seen.add(id);stack.add(id);for(const next of graph.get(id)||[])if(visit(next))return true;stack.delete(id);return false};
  return [...graph.keys()].some(visit);
}

export function myWork(tasks:WorkTask[],userId:string,now=new Date()){
  const mine=tasks.filter(task=>task.assigned_to_user_id===userId&&!['done','cancelled','archived'].includes(task.status));
  const end=new Date(now);end.setHours(23,59,59,999);const next=new Date(end);next.setDate(next.getDate()+7);
  return{all:mine,overdue:mine.filter(x=>x.due_at&&new Date(x.due_at)<now),today:mine.filter(x=>x.due_at&&new Date(x.due_at)>=now&&new Date(x.due_at)<=end),upcoming:mine.filter(x=>x.due_at&&new Date(x.due_at)>end&&new Date(x.due_at)<=next),blocked:mine.filter(x=>x.status==='blocked'),review:mine.filter(x=>x.status==='review')};
}

export function projectProgress(tasks:WorkTask[]){const relevant=tasks.filter(x=>!['cancelled','archived'].includes(x.status));return relevant.length?Math.round(relevant.filter(x=>x.status==='done').length/relevant.length*100):0}
export function workloadSummary(tasks:WorkTask[]){const map=new Map<string,{assignee:string;open:number;critical:number;estimatedHours:number}>();for(const task of tasks.filter(x=>!['done','cancelled','archived'].includes(x.status))){const key=task.assigned_to_user_id||'unassigned',row=map.get(key)||{assignee:key,open:0,critical:0,estimatedHours:0};row.open++;if(task.priority==='critical'||task.severity==='critical')row.critical++;row.estimatedHours+=Number(task.estimate_hours||0);map.set(key,row)}return[...map.values()]}
export function roadmapScore(input:{reach_score?:number;impact_score?:number;confidence_score?:number;effort_score?:number}){const reach=Math.max(0,Number(input.reach_score||0)),impact=Math.max(0,Number(input.impact_score||0)),confidence=Math.min(100,Math.max(0,Number(input.confidence_score||0)))/100,effort=Math.max(.1,Number(input.effort_score||1));return{score:Number((reach*impact*confidence/effort).toFixed(2)),classification:'estimate' as const,note:'Sinal RICE-like para apoiar revisão humana; não é decisão automática.'}}
const words=(s:string)=>new Set(s.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(x=>x.length>2));
export function possibleDuplicates<T extends{title:string;description?:string|null}>(candidate:T,items:T[]){const a=words(`${candidate.title} ${candidate.description||''}`);return items.map(item=>{const b=words(`${item.title} ${item.description||''}`),common=[...a].filter(x=>b.has(x)).length,union=new Set([...a,...b]).size;return{item,similarity:union?common/union:0}}).filter(x=>x.similarity>=.35).sort((x,y)=>y.similarity-x.similarity)}

export function approvalState(required:number,steps:{decision:string}[]){const approved=steps.filter(x=>x.decision==='approved').length,rejected=steps.some(x=>x.decision==='rejected');return{approved,required,status:rejected?'rejected':approved>=required?'approved':'pending',canExecute:!rejected&&approved>=required}}
export function automationDecision(input:{eventKey:string;lastRuns:{event_key:string;created_at:string}[];cooldownSeconds:number;now?:Date}){const now=input.now||new Date(),duplicate=input.lastRuns.find(x=>x.event_key===input.eventKey),withinCooldown=input.lastRuns.some(x=>(now.getTime()-new Date(x.created_at).getTime())/1000<input.cooldownSeconds);return{run:!duplicate&&!withinCooldown,reason:duplicate?'duplicate':withinCooldown?'cooldown':'eligible',requiresHumanConfirmation:true}}

export function operationalRisks(tasks:WorkTask[],toleranceHours=24,now=new Date()){
  const tolerance=toleranceHours*3600000;return tasks.flatMap(task=>{if(['done','cancelled','archived'].includes(task.status))return[];const risks:any[]=[];if(task.due_at&&now.getTime()-new Date(task.due_at).getTime()>tolerance)risks.push({type:'delayed_work',severity:task.priority==='critical'?'critical':'warning',taskId:task.id,title:task.title});if((task.task_type==='bug'||task.severity==='critical')&&task.severity==='critical'&&!task.assigned_to_user_id)risks.push({type:'critical_bug_without_owner',severity:'critical',taskId:task.id,title:task.title});return risks})
}

export const internalCopilotTools=['getMyTasks','getProjectStatus','getBlockedWork','getPendingApprovals','getRoadmapSummary','getCriticalBugs','getStrategicInitiatives','getRecentDecisions'] as const;
export function internalCopilot(tool:string,context:Record<string,any>){
  const result:Record<string,unknown>={getMyTasks:context.myTasks||[],getProjectStatus:context.projects||[],getBlockedWork:(context.tasks||[]).filter((x:WorkTask)=>x.status==='blocked'),getPendingApprovals:(context.approvals||[]).filter((x:any)=>x.status==='pending'),getRoadmapSummary:context.roadmap||[],getCriticalBugs:(context.tasks||[]).filter((x:WorkTask)=>x.task_type==='bug'&&x.severity==='critical'&&!['done','cancelled','archived'].includes(x.status)),getStrategicInitiatives:context.initiatives||[],getRecentDecisions:context.decisions||[]};
  if(!internalCopilotTools.includes(tool as any))throw new Error('Ferramenta interna inválida.');
  return{tool,result:result[tool],classification:'internal_summary',humanReviewRequired:true,automaticChange:false,forbiddenActions:['approve_critical_action','change_strategic_roadmap','cancel_project','change_targets','publish_release']};
}
