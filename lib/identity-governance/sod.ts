/* eslint-disable @typescript-eslint/no-explicit-any */
/* Segregation of duties against real grants, before a request (preventive) and over what already exists (detective). */
import {SOD_RULE_TEMPLATES,SegregationOfDutiesService} from "./rules.ts";
import {governanceAudit} from "./server.ts";
import {emitIdentityEvent} from "./soc-events.ts";

type Ctx={admin:any;organizationId:string;actorId:string|null};
const LIVE=["active","expiring"];

export async function seedSodRuleDrafts(ctx:Ctx){const{data:existing}=await ctx.admin.from("sod_rule_definitions").select("key").eq("organization_id",ctx.organizationId),known=new Set((existing||[]).map((x:any)=>x.key)),fresh=SOD_RULE_TEMPLATES.filter(x=>!known.has(x.key)).map(x=>({...x,conflicting_entitlement_refs:[...x.conflicting_entitlement_refs],organization_id:ctx.organizationId,status:"draft"}));if(fresh.length){const{error}=await ctx.admin.from("sod_rule_definitions").insert(fresh);if(error)throw new Error(error.message)}return{created:fresh.length}}

const heldKeys=async(ctx:Ctx,identityId:string)=>{const{data}=await ctx.admin.from("access_grants").select("access_entitlements(key)").eq("identity_id",identityId).in("status",LIVE);return(data||[]).map((x:any)=>x.access_entitlements?.key).filter(Boolean) as string[]};
const activeRules=async(ctx:Ctx)=>{const{data}=await ctx.admin.from("sod_rule_definitions").select("*").eq("organization_id",ctx.organizationId).eq("status","active");return data||[]};
const activeTreatments=async(ctx:Ctx,identityId:string)=>{const{data}=await ctx.admin.from("sod_conflicts").select("rule_id,sod_rule_definitions(key),sod_mitigations(kind,status,expires_at)").eq("organization_id",ctx.organizationId).eq("identity_id",identityId);return(data||[]).flatMap((c:any)=>(c.sod_mitigations||[]).map((m:any)=>({rule_key:c.sod_rule_definitions?.key,...m})))};

export async function checkPreventiveSod(ctx:Ctx,input:{identity:any;entitlement:any}){
  const service=new SegregationOfDutiesService(),rules=await activeRules(ctx),conflicts=service.preventive({rules,held:await heldKeys(ctx,input.identity.id),requested:input.entitlement.key});
  if(!conflicts.length)return{result:"no_conflict",conflicts:[],blocking:[]};
  const resolved=service.resolve({conflicts,mitigations:await activeTreatments(ctx,input.identity.id)});
  for(const c of conflicts){const{data}=await ctx.admin.from("sod_conflicts").upsert({organization_id:ctx.organizationId,identity_id:input.identity.id,rule_id:c.id,rule_version:c.version||1,entitlement_refs:c.conflicting_entitlement_refs,detection:"preventive",result:resolved.blocking.includes(c.key)?"conflict_blocked":resolved.result,severity:c.severity,status:resolved.blocking.includes(c.key)?"open":resolved.result==="conflict_mitigated"?"mitigated":"accepted",fingerprint:`${input.identity.id}:${c.id}`},{onConflict:"organization_id,fingerprint"}).select("id").single();await emitIdentityEvent(ctx.admin,{organizationId:ctx.organizationId,kind:"elevation",sourceEventId:`sod:${data?.id}:preventive`,actorRef:ctx.actorId,targetType:"sod_conflict",targetRef:input.identity.identity_ref,severity:c.severity==="critical"?"high":"warning",title:`Conflito SoD no pedido: ${c.key}`,metadata:{rule:c.key}})}
  return{result:resolved.result,blocking:resolved.blocking,conflicts:conflicts.map((c:any)=>({rule:c.key,severity:c.severity}))};
}

export async function runDetectiveSod(ctx:Ctx){
  const[{data:grants},rules]=await Promise.all([ctx.admin.from("access_grants").select("identity_id,access_entitlements(key)").eq("organization_id",ctx.organizationId).in("status",LIVE),activeRules(ctx)]),by=new Map<string,string[]>();
  for(const g of grants||[])if(g.access_entitlements?.key)by.set(g.identity_id,[...(by.get(g.identity_id)||[]),g.access_entitlements.key]);
  const found=new SegregationOfDutiesService().detective({rules,holdings:[...by].map(([identityId,keys])=>({identityId,keys}))});let created=0;
  for(const f of found){const fingerprint=`${f.identityId}:${f.rule.id}`,{data:existing}=await ctx.admin.from("sod_conflicts").select("id").eq("organization_id",ctx.organizationId).eq("fingerprint",fingerprint).maybeSingle();if(existing)continue;const{data:conflict}=await ctx.admin.from("sod_conflicts").insert({organization_id:ctx.organizationId,identity_id:f.identityId,rule_id:f.rule.id,rule_version:f.rule.version||1,entitlement_refs:f.rule.conflicting_entitlement_refs,detection:"detective",result:"conflict_blocked",severity:f.rule.severity,status:"open",fingerprint}).select("id").single();await ctx.admin.from("access_findings").upsert({organization_id:ctx.organizationId,finding_type:"sod_conflict",severity:f.rule.severity,identity_id:f.identityId,title:`Conflito SoD: ${f.rule.key}`,priority_reasons:[`regra:${f.rule.key}`,`severidade:${f.rule.severity}`],evidence:{rule:f.rule.key,conflict:conflict?.id},fingerprint:`sod_conflict:${fingerprint}`},{onConflict:"organization_id,fingerprint",ignoreDuplicates:true});created++}
  return{found:found.length,created};
}

export async function treatSodConflict(ctx:Ctx,input:{conflictId:string;kind:"mitigation"|"acceptance";control:string;owner:string;reason:string;expiresAt:string;approvers:string[]}){
  const{data:conflict}=await ctx.admin.from("sod_conflicts").select("*,sod_rule_definitions(mitigation_allowed,key),governed_identities(user_id)").eq("id",input.conflictId).eq("organization_id",ctx.organizationId).maybeSingle();
  if(!conflict)throw new Error("CONFLICT_NOT_FOUND");
  const approvers=[...new Set(input.approvers)].filter(x=>x!==conflict.governed_identities?.user_id),validation=new SegregationOfDutiesService().validateTreatment({kind:input.kind,severity:conflict.severity,mitigationAllowed:conflict.sod_rule_definitions?.mitigation_allowed,owner:input.owner,reason:input.reason,control:input.control,expiresAt:input.expiresAt,approvers});
  if(!validation.valid)throw new Error(validation.issues.join(","));
  const{data,error}=await ctx.admin.from("sod_mitigations").insert({organization_id:ctx.organizationId,conflict_id:conflict.id,kind:input.kind,severity:conflict.severity,control_description:input.control,owner_ref:input.owner,reason:input.reason,expires_at:input.expiresAt,approved_by:approvers,status:"active",created_by:ctx.actorId}).select().single();
  if(error)throw new Error(error.message);
  const status=input.kind==="mitigation"?"mitigated":"accepted";
  await ctx.admin.from("sod_conflicts").update({status,result:input.kind==="mitigation"?"conflict_mitigated":"conflict_accepted"}).eq("id",conflict.id);
  await governanceAudit(ctx.admin,{organizationId:ctx.organizationId,actorId:ctx.actorId,action:`sod_${status}`,resourceType:"sod_conflict",resourceId:conflict.id,reason:input.reason,metadata:{rule:conflict.sod_rule_definitions?.key,expires_at:input.expiresAt,approvers:approvers.length}});
  return data;
}

// An expired treatment reopens the conflict: temporary tolerance must not turn permanent by default.
export async function expireSodTreatments(ctx:Ctx,now=new Date()){const{data}=await ctx.admin.from("sod_mitigations").select("id,conflict_id").eq("organization_id",ctx.organizationId).eq("status","active").lte("expires_at",now.toISOString());for(const m of data||[]){await ctx.admin.from("sod_mitigations").update({status:"expired"}).eq("id",m.id);await ctx.admin.from("sod_conflicts").update({status:"open",result:"conflict_blocked"}).eq("id",m.conflict_id)}return{expired:(data||[]).length}}
