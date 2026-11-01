/* eslint-disable @typescript-eslint/no-explicit-any */
import {createAdminClient} from "@/lib/supabase/admin";
import {evaluateMany,resolveDecision,type EvaluationContext,type Policy} from "./core";

const CACHE_TTL_MS=60_000;
type CacheEntry={expires:number;policies:Policy[]};
const activeCache=new Map<string,CacheEntry>();

export function invalidatePolicyCache(organizationId?:string){if(organizationId)activeCache.delete(organizationId);else activeCache.clear()}

export async function loadActivePolicies(organizationId:string,policyKey?:string):Promise<Policy[]>{
  const cacheKey=`${organizationId}:${policyKey||"*"}`,cached=activeCache.get(cacheKey);if(cached&&cached.expires>Date.now())return cached.policies;
  const admin=createAdminClient();let query=admin.from("policy_active_documents").select("document").eq("organization_id",organizationId);if(policyKey)query=query.eq("policy_key",policyKey);
  const{data,error}=await query;if(error)throw error;const policies=(data||[]).map((row:any)=>row.document as Policy);activeCache.set(cacheKey,{expires:Date.now()+CACHE_TTL_MS,policies});return policies;
}

export async function decide(input:{organizationId:string;policyKey?:string;context:EvaluationContext}){const policies=await loadActivePolicies(input.organizationId,input.policyKey),decisions=evaluateMany(policies,input.context);return{decision:resolveDecision(decisions),details:decisions}}

export async function logDecision(input:{organizationId:string;storeId?:string;domain:string;subjectType:string;subjectId?:string;decision:any;durationMs:number;auditMode:string;requestId?:string}){
  if(input.auditMode==="none")return;const admin=createAdminClient();const sampled=input.auditMode==="full"||input.auditMode==="sampled"&&Math.random()<.05;
  if(sampled)await admin.from("policy_decision_logs").insert({organization_id:input.organizationId,store_id:input.storeId||null,domain:input.domain,subject_type:input.subjectType,subject_id:input.subjectId||null,decision:input.decision.decision,effect:input.decision.effect,policy_id:input.decision.policyId,policy_version:input.decision.policyVersion,matched_rule_ids:input.decision.matchedRuleIds,duration_ms:input.durationMs,request_id:input.requestId||null,sampled:true,explanation:input.decision.explanation});
  else await admin.rpc("record_policy_decision_aggregate",{requested_organization_id:input.organizationId,requested_domain:input.domain,requested_decision:input.decision.decision,requested_duration_ms:input.durationMs});
}

export function cacheStats(){return{entries:activeCache.size,keys:[...activeCache.keys()]}}
