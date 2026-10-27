import { createHash } from "node:crypto";

export const FEATURE_PERMISSIONS=["feature_management:view","feature_management:manage_definitions","feature_management:publish","feature_management:manage_rollouts","feature_management:manage_overrides","feature_management:kill_switch","feature_management:manage_configuration","feature_management:view_audit"]as const;
export const FEATURE_AUTOMATION_TRIGGERS=["feature.rollout_started","feature.rollout_paused","feature.rollout_health_degraded","feature.override_expiring","feature.override_expired","feature.kill_switch_activated","feature.cleanup_overdue"]as const;
export const FEATURE_AUTOMATION_ACTIONS=["feature.pause_rollout","feature.advance_rollout","feature.rollback_rollout","feature.activate_kill_switch","feature.revoke_override","feature.create_review_task"]as const;
export const FEATURE_REPORT_DATASETS=["feature_definitions","feature_evaluations_aggregated","feature_rollouts","feature_rollout_health","feature_overrides","feature_changes","configuration_values"]as const;
export const FEATURE_WIDGETS=["feature_rollouts_active","feature_health_alerts","feature_overrides_expiring","feature_cleanup_overdue"]as const;
export const FEATURE_COPILOT_TOOLS=["getFeatureDefinition","explainFeatureDecision","simulateFeatureEvaluation","getRolloutHealth","listExpiringOverrides","listCleanupOverdue"]as const;
export type FeatureValueType="boolean"|"string"|"number"|"enum"|"structured";
export type ScopeType="global"|"organization"|"brand"|"region"|"store";
export type FeatureValue=boolean|string|number|Record<string,unknown>|unknown[]|null;
export type EvaluationContext={environment:string;subjectId:string;subjectType?:string;organizationId?:string;brandId?:string;regionId?:string;storeId?:string;planCode?:string;roles?:string[];platform?:string;appVersion?:string;attributes?:Record<string,string|number|boolean|null>};
export type FeatureDefinition={key:string;name?:string;valueType:FeatureValueType;defaultValue:FeatureValue;safeDefault:FeatureValue;enumValues?:string[];schema?:Record<string,unknown>;clientSafe?:boolean;entitlementKey?:string|null;experimentKey?:string|null;owner?:string;expiresAt?:string|null;dependencies?:Array<{key:string;expected?:FeatureValue}>};
export type TargetingRule={id:string;priority:number;enabled?:boolean;conditions:Record<string,unknown>;value:FeatureValue;percentageBps?:number};
export type FeatureOverride={id:string;featureKey:string;scopeType:ScopeType;scopeId?:string|null;environment:string;value:FeatureValue;startsAt?:string;expiresAt:string;revokedAt?:string|null;reason:string};
export type KillSwitch={featureKey:string;environment:string;active:boolean;value?:FeatureValue;reason?:string};
export type ExperimentAssignment={experimentKey:string;variant:string;value:FeatureValue};
export type EvaluationInput={definition:FeatureDefinition;context:EvaluationContext;now?:Date;entitlementAllowed?:boolean;blocklist?:string[];allowlist?:string[];killSwitch?:KillSwitch|null;overrides?:FeatureOverride[];experiment?:ExperimentAssignment|null;rules?:TargetingRule[];rolloutBps?:number;lastKnownGood?:FeatureValue};
export type EvaluationResult={key:string;value:FeatureValue;enabled:boolean;reason:string;source:string;ruleId?:string;bucket?:number;configurationVersion?:string;safeFallback:boolean;evaluatedAt:string};

const canonical=(value:unknown):string=>{if(Array.isArray(value))return`[${value.map(canonical).join(",")}]`;if(value&&typeof value==="object")return`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;return JSON.stringify(value)};
export const stableBucket=(featureKey:string,context:Pick<EvaluationContext,"subjectId"|"subjectType">,salt="v1")=>Number.parseInt(createHash("sha256").update(`${salt}:${featureKey}:${context.subjectType||"user"}:${context.subjectId}`).digest("hex").slice(0,12),16)%10000;
export const configurationFingerprint=(value:unknown)=>createHash("sha256").update(canonical(value)).digest("hex");

export function validateTypedValue(definition:Pick<FeatureDefinition,"valueType"|"enumValues"|"schema">,value:FeatureValue){
 if(value===null)return{valid:false,errors:["NULL_NOT_ALLOWED"]};const errors:string[]=[];
 if(definition.valueType==="boolean"&&typeof value!=="boolean")errors.push("EXPECTED_BOOLEAN");
 if(definition.valueType==="string"&&typeof value!=="string")errors.push("EXPECTED_STRING");
 if(definition.valueType==="number"&&(typeof value!=="number"||!Number.isFinite(value)))errors.push("EXPECTED_FINITE_NUMBER");
 if(definition.valueType==="enum"&&(typeof value!=="string"||!definition.enumValues?.includes(value)))errors.push("INVALID_ENUM_VALUE");
 if(definition.valueType==="structured"){
  if(!definition.schema||typeof definition.schema!=="object")errors.push("STRUCTURED_SCHEMA_REQUIRED");
  if(!value||typeof value!=="object")errors.push("EXPECTED_STRUCTURED_VALUE");
  const schema=definition.schema||{},required=Array.isArray(schema.required)?schema.required as string[]:[];
  for(const key of required)if(!(key in (value as Record<string,unknown>)))errors.push(`MISSING_${key}`);
 }
 return{valid:errors.length===0,errors};
}

export class FeatureRegistryService{
 validate(definition:FeatureDefinition){if(!/^[a-z][a-z0-9_.-]{2,119}$/.test(definition.key))throw new Error("INVALID_FEATURE_KEY");if(/secret|token|password|credential/i.test(definition.key))throw new Error("SECRETS_NOT_ALLOWED");if(!definition.owner?.trim())throw new Error("FEATURE_OWNER_REQUIRED");for(const value of[definition.defaultValue,definition.safeDefault]){const result=validateTypedValue(definition,value);if(!result.valid)throw new Error(result.errors[0])}return{...definition,key:definition.key.trim(),owner:definition.owner.trim(),status:"draft",immutablePublishedVersions:true}}
 detectCycles(definitions:FeatureDefinition[]){const graph=new Map(definitions.map(d=>[d.key,(d.dependencies||[]).map(x=>x.key)])),visiting=new Set<string>(),visited=new Set<string>(),cycles:string[][]=[];const walk=(key:string,path:string[])=>{if(visiting.has(key)){cycles.push([...path.slice(path.indexOf(key)),key]);return}if(visited.has(key))return;visiting.add(key);for(const dep of graph.get(key)||[])walk(dep,[...path,key]);visiting.delete(key);visited.add(key)};for(const key of graph.keys())walk(key,[]);return cycles}
 publish(definition:FeatureDefinition,version:number,actorId:string,reason:string){this.validate(definition);if(this.detectCycles([definition]).length)throw new Error("DEPENDENCY_CYCLE");if(!actorId||reason.trim().length<5)throw new Error("PUBLISH_REASON_REQUIRED");return{featureKey:definition.key,version,status:"published",publishedBy:actorId,publishedAt:new Date().toISOString(),fingerprint:configurationFingerprint(definition),reason}}
}

const matchesSemver=(actual:string|undefined,expected:unknown)=>{if(!expected)return true;if(!actual)return false;const [a,b,c]=actual.split(".").map(Number),version=a*1e6+b*1e3+c;if(typeof expected==="string"){const [op,raw]=expected.match(/^(>=|<=|>|<|=)?(.+)$/)?.slice(1)||[];const[v1,v2,v3]=String(raw).split(".").map(Number),target=v1*1e6+v2*1e3+v3;return op===">"?version>target:op==="<"?version<target:op==="<="?version<=target:op==="="?version===target:version>=target}return false};
const inList=(value:string|undefined,expected:unknown)=>!Array.isArray(expected)||expected.length===0||Boolean(value&&expected.map(String).includes(value));
export function matchConditions(conditions:Record<string,unknown>,context:EvaluationContext){for(const[key,value]of Object.entries(conditions)){if(key==="organization_ids"&&!inList(context.organizationId,value))return false;if(key==="brand_ids"&&!inList(context.brandId,value))return false;if(key==="region_ids"&&!inList(context.regionId,value))return false;if(key==="store_ids"&&!inList(context.storeId,value))return false;if(key==="plan_codes"&&!inList(context.planCode,value))return false;if(key==="roles"&&!(context.roles||[]).some(x=>(value as unknown[]||[]).map(String).includes(x)))return false;if(key==="platforms"&&!inList(context.platform,value))return false;if(key==="app_version"&&!matchesSemver(context.appVersion,value))return false;if(key.startsWith("attribute.")){const attribute=key.slice(10);if(context.attributes?.[attribute]!==value)return false}}return true}
const scopeMatch=(override:FeatureOverride,context:EvaluationContext)=>override.scopeType==="global"||override.scopeType==="organization"&&override.scopeId===context.organizationId||override.scopeType==="brand"&&override.scopeId===context.brandId||override.scopeType==="region"&&override.scopeId===context.regionId||override.scopeType==="store"&&override.scopeId===context.storeId;
const scopeRank:Record<ScopeType,number>={global:0,organization:1,brand:2,region:3,store:4};

export class FeatureEvaluationService{
 private cache=new Map<string,{expires:number,result:EvaluationResult}>();private ttlMs:number;private maxEntries:number;constructor(ttlMs=30000,maxEntries=10000){this.ttlMs=ttlMs;this.maxEntries=maxEntries}
 evaluate(input:EvaluationInput):EvaluationResult{
  const now=input.now||new Date(),d=input.definition,c=input.context,key=configurationFingerprint({d,c,kill:input.killSwitch,overrides:input.overrides,rules:input.rules,rollout:input.rolloutBps,entitlement:input.entitlementAllowed,experiment:input.experiment}),cached=this.cache.get(key);
  if(cached&&cached.expires>now.getTime())return{...cached.result,reason:`${cached.result.reason}:cache`};
  let value=d.defaultValue,reason="default",source="definition",ruleId:string|undefined,bucket:number|undefined,safeFallback=false;
  try{
   if(input.killSwitch?.active){value=input.killSwitch.value??d.safeDefault;reason="kill_switch";source="kill_switch"}
   else if(d.entitlementKey&&input.entitlementAllowed!==true){value=d.safeDefault;reason="entitlement_denied";source="phase22_entitlement"}
   else if(input.blocklist?.includes(c.subjectId)){value=d.safeDefault;reason="explicit_blocklist";source="access_program"}
   else{
    const active=(input.overrides||[]).filter(x=>x.featureKey===d.key&&x.environment===c.environment&&!x.revokedAt&&new Date(x.expiresAt)>now&&(!x.startsAt||new Date(x.startsAt)<=now)&&scopeMatch(x,c)).sort((a,b)=>scopeRank[b.scopeType]-scopeRank[a.scopeType]);
    if(active[0]){value=active[0].value;reason="temporary_override";source=active[0].id}
    else if(d.experimentKey&&input.experiment?.experimentKey===d.experimentKey){value=input.experiment.value;reason=`experiment:${input.experiment.variant}`;source="phase28_experiment"}
    else{
     const rule=(input.rules||[]).filter(x=>x.enabled!==false&&matchConditions(x.conditions,c)).sort((a,b)=>a.priority-b.priority)[0];
     if(rule){bucket=stableBucket(`${d.key}:${rule.id}`,c);if(rule.percentageBps===undefined||bucket<rule.percentageBps){value=rule.value;reason="targeting_rule";source="rule";ruleId=rule.id}else{value=d.safeDefault;reason="rule_percentage_excluded";source="rule";ruleId=rule.id}}
     else if(input.allowlist?.includes(c.subjectId)){value=d.defaultValue;reason="explicit_allowlist";source="access_program"}
     else if(input.rolloutBps!==undefined){bucket=stableBucket(d.key,c);value=bucket<input.rolloutBps?d.defaultValue:d.safeDefault;reason=bucket<input.rolloutBps?"rollout_included":"rollout_excluded";source="rollout"}
    }
   }
   const validation=validateTypedValue(d,value);if(!validation.valid)throw new Error(validation.errors[0]);
  }catch{value=input.lastKnownGood??d.safeDefault;reason=input.lastKnownGood!==undefined?"last_known_good":"safe_default";source="fallback";safeFallback=true}
  const result:EvaluationResult={key:d.key,value,enabled:value===true,reason,source,ruleId,bucket,configurationVersion:configurationFingerprint({value,source}).slice(0,16),safeFallback,evaluatedAt:now.toISOString()};
  if(this.cache.size>=this.maxEntries)this.cache.delete(this.cache.keys().next().value as string);this.cache.set(key,{expires:now.getTime()+this.ttlMs,result});return result
 }
 evaluateMany(inputs:EvaluationInput[]){return inputs.map(x=>this.evaluate(x))}
 exposeClient(results:EvaluationResult[],definitions:FeatureDefinition[]){const safe=new Set(definitions.filter(x=>x.clientSafe).map(x=>x.key));return Object.fromEntries(results.filter(x=>safe.has(x.key)).map(x=>[x.key,{value:x.value,version:x.configurationVersion}]))}
 invalidate(featureKey?:string){if(!featureKey)return this.cache.clear();for(const[k,v]of this.cache)if(v.result.key===featureKey)this.cache.delete(k)}
}

export type ConfigurationValue={definitionKey:string;scopeType:ScopeType;scopeId?:string|null;environment:string;value:FeatureValue;effectiveFrom?:string;effectiveUntil?:string|null;status?:string;version?:number};
export class ConfigurationResolverService{
 resolve(definition:FeatureDefinition,values:ConfigurationValue[],context:EvaluationContext,now=new Date()){const ids:Record<ScopeType,string|undefined>={global:undefined,organization:context.organizationId,brand:context.brandId,region:context.regionId,store:context.storeId},eligible=values.filter(x=>x.definitionKey===definition.key&&x.environment===context.environment&&x.status!=="revoked"&&(!x.effectiveFrom||new Date(x.effectiveFrom)<=now)&&(!x.effectiveUntil||new Date(x.effectiveUntil)>now)&&x.scopeId===ids[x.scopeType]).sort((a,b)=>scopeRank[b.scopeType]-scopeRank[a.scopeType]||Number(b.version||0)-Number(a.version||0)),selected=eligible[0],value=selected?.value??definition.defaultValue,validation=validateTypedValue(definition,value);return validation.valid?{value,sourceScope:selected?.scopeType||"default",sourceId:selected?.scopeId||null,version:selected?.version||0}:{value:definition.safeDefault,sourceScope:"safe_default",sourceId:null,version:0}}
 preview(definition:FeatureDefinition,current:ConfigurationValue[],proposed:ConfigurationValue,contexts:EvaluationContext[]){return contexts.map(context=>({context,before:this.resolve(definition,current,context),after:this.resolve(definition,[...current,proposed],context)}))}
}

export class FeatureDependencyService{evaluate(definition:FeatureDefinition,resolved:Map<string,EvaluationResult>){const unmet=(definition.dependencies||[]).filter(x=>!resolved.has(x.key)||resolved.get(x.key)?.value!==(x.expected??true));return{allowed:unmet.length===0,unmet:unmet.map(x=>x.key)}}}
export class FeatureRolloutService{
 nextStage(stages:Array<{id:string;order:number;percentageBps:number;status:string}>,health:{status:string;errorRate?:number},approval?:{approvedBy:string;reason:string}){const current=stages.find(x=>x.status==="active"),next=stages.filter(x=>x.status==="pending").sort((a,b)=>a.order-b.order)[0];if(!current||!next)return{advanced:false,reason:"NO_NEXT_STAGE"};if(["degraded","critical"].includes(health.status))return{advanced:false,reason:"HEALTH_GATE_FAILED",recommendedAction:"pause_or_rollback"};if(next.percentageBps>=5000&&!approval?.approvedBy)return{advanced:false,reason:"HUMAN_APPROVAL_REQUIRED"};return{advanced:true,from:current.id,to:next.id,percentageBps:next.percentageBps}}
 health(metrics:{errorRate:number;latencyP95:number;conversionDelta?:number;sampleSize:number},thresholds:{maxErrorRate:number;maxLatencyP95:number;minSampleSize:number;minConversionDelta?:number}){const insufficient=metrics.sampleSize<thresholds.minSampleSize,breaches=[metrics.errorRate>thresholds.maxErrorRate&&"error_rate",metrics.latencyP95>thresholds.maxLatencyP95&&"latency",thresholds.minConversionDelta!==undefined&&Number(metrics.conversionDelta)<thresholds.minConversionDelta&&"conversion"].filter(Boolean);return{status:insufficient?"insufficient_data":breaches.length?"degraded":"healthy",breaches,metrics,automaticDecision:false}}
 rollback(featureKey:string,reason:string,actorId:string){if(!reason.trim()||!actorId)throw new Error("ROLLBACK_REASON_REQUIRED");return{featureKey,status:"rolled_back",reason,actorId,at:new Date().toISOString(),auditRequired:true}}
}
export class FeatureCleanupService{stale(definitions:FeatureDefinition[],now=new Date()){return definitions.filter(x=>x.expiresAt&&new Date(x.expiresAt)<now).map(x=>({key:x.key,owner:x.owner,status:"cleanup_overdue",automaticDelete:false}))}}
export function featureCopilot(tool:string,context:Record<string,unknown>){if(!FEATURE_COPILOT_TOOLS.includes(tool as typeof FEATURE_COPILOT_TOOLS[number]))throw new Error("FEATURE_TOOL_NOT_ALLOWED");return{tool,facts:context.facts||[],decisionTrace:context.decisionTrace||[],unknowns:context.unknowns||[],canPublish:false,canAdvanceRollout:false,canActivateKillSwitch:false,requiresHumanApproval:true}}
