import type {Obligation,PolicyDecision,TypedValue} from "./core";

export type PolicyFactProvider={source:"evaluation_context"|"entity_field"|"entitlement"|"feature_state"|"semantic_metric"|"domain_fact";key:string;version:number;sensitive?:boolean;resolve:(context:Record<string,unknown>)=>Promise<TypedValue|undefined>};

export async function resolveFacts(providers:PolicyFactProvider[],context:Record<string,unknown>){
  const entries=await Promise.all(providers.map(async provider=>[`${provider.source}:${provider.key}`,await provider.resolve(context)] as const));
  return Object.fromEntries(entries);
}

export function approvalRequestFromDecision(decision:PolicyDecision,input:{title:string;description:string;requestedBy:string;sourceId:string}){
  if(decision.decision!=="require_approval")return null;
  const approval=decision.obligations.find(x=>x.type==="approval");
  return{approval_type:"policy_decision",title:input.title,description:input.description,source_type:"policy_decision",source_id:input.sourceId,status:"pending",risk_level:"high",requested_by:input.requestedBy,required_approvals:Number(approval?.metadata?.requiredApprovals||1),policy_reference:{policyId:decision.policyId,version:decision.policyVersion,matchedRules:decision.matchedRuleIds}};
}

export function actionConstraintsFromDecision(decision:PolicyDecision){
  if(decision.decision==="deny"||decision.decision==="indeterminate")return{allowed:false,reason:decision.explanation,obligations:[] as Obligation[]};
  if(decision.decision==="require_approval"||decision.decision==="require_review")return{allowed:false,pending:true,reason:decision.explanation,obligations:decision.obligations};
  return{allowed:true,reason:decision.explanation,obligations:decision.obligations};
}

export const PILOT_ADAPTERS={
  discountApproval:{domain:"sales",enforcementPoint:"checkout_or_pos",approvalEngine:true,actionEngine:false,authoritativeFacts:["discount.percent","actor.self_limit","actor.role"]},
  refundApproval:{domain:"payments",enforcementPoint:"refund_request",approvalEngine:true,actionEngine:true,authoritativeFacts:["refund.amount","order.status","payment.refundable"]},
  supplierEligibility:{domain:"procurement",enforcementPoint:"supplier_selection",approvalEngine:false,actionEngine:false,authoritativeFacts:["supplier.status","supplier.compliance_status","supplier.blocked"]},
  purchaseApproval:{domain:"procurement",enforcementPoint:"purchase_request",approvalEngine:true,actionEngine:false,authoritativeFacts:["purchase.amount","purchase.category","budget.available"]},
  franchiseLocalOverride:{domain:"network_governance",enforcementPoint:"override_request",approvalEngine:true,actionEngine:true,authoritativeFacts:["override.field","central_policy.locked","scope.precedence"]}
} as const;

export const INTEGRATION_BOUNDARIES={
  entitlements:"read_only_fact_provider",
  featureManagement:"read_only_fact_provider",
  networkGovernance:"scope_and_lock_authority",
  approvalEngine:"obligation_consumer",
  actionEngine:"effect_executor_after_revalidation",
  automation:"event_consumer_and_policy_client",
  dataPlatform:"sampled_decisions_and_aggregates_only",
  reporting:"semantic_views_only"
} as const;
