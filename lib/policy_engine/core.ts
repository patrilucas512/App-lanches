/* Safe, deterministic Policy Decision Point. No eval, SQL, HTTP or executable payloads. */
export const POLICY_TYPES=["eligibility","limit","approval","routing","validation","restriction","calculation_selector","escalation","exception","governance","custom_safe_type"] as const;
export const POLICY_OPERATORS=["equals","not_equals","in","not_in","greater_than","greater_or_equal","less_than","less_or_equal","between","exists","not_exists","contains","starts_with","ends_with","date_before","date_after","date_between"] as const;
export const POLICY_EFFECTS=["allow","deny","require_approval","warn","route","set_limit","require_review","no_op"] as const;
export const POLICY_DECISIONS=["allow","deny","allow_with_conditions","require_approval","require_review","warn","not_applicable","indeterminate"] as const;
export const OPERAND_SOURCES=["evaluation_context","entity_field","entitlement","feature_state","semantic_metric","domain_fact","policy_parameter","current_time","static_value"] as const;
export type PolicyOperator=typeof POLICY_OPERATORS[number];
export type PolicyEffect=typeof POLICY_EFFECTS[number];
export type DecisionValue=typeof POLICY_DECISIONS[number];
export type ValueType="text"|"integer"|"decimal"|"boolean"|"date"|"datetime"|"duration"|"currency"|"set";
export type TypedValue={type:ValueType;value:string|boolean|string[]};
export type Operand={source:typeof OPERAND_SOURCES[number];key?:string;value?:TypedValue};
export type Condition={id:string;left:Operand;operator:PolicyOperator;right?:Operand;right2?:Operand};
export type ConditionGroup={id:string;mode:"all"|"any"|"none";conditions:Condition[];groups?:ConditionGroup[]};
export type Obligation={type:"approval"|"review"|"route"|"limit"|"warning";target?:string;value?:TypedValue;metadata?:Record<string,string|number|boolean>};
export type Rule={id:string;name:string;priority:number;enabled:boolean;effect:PolicyEffect;conditions:ConditionGroup;obligations?:Obligation[];explanation:string};
export type ScopeType="global"|"organization"|"brand"|"region"|"store"|"plan"|"channel"|"role"|"business_type";
export type Policy={id:string;key:string;version:number;evaluatorVersion:string;policyType:typeof POLICY_TYPES[number];risk:"low"|"medium"|"high"|"critical";status:"draft"|"review"|"approved"|"active"|"superseded"|"archived";evaluationMode:"first_match"|"all_match"|"deny_overrides"|"allow_overrides"|"priority"|"scoreless_decision";failMode:"fail_closed"|"fail_open"|"require_manual_review"|"default_effect";defaultEffect:PolicyEffect;scope:{type:ScopeType;id?:string;precedence:number;locked?:boolean};rules:Rule[];offlineSafe?:boolean;auditMode:"none"|"aggregate"|"sampled"|"full"};
export type EvaluationContext={facts:Record<string,TypedValue|undefined>;parameters?:Record<string,TypedValue>;now?:string;scopeChain?:Array<{type:ScopeType;id?:string}>;offline?:boolean;requestId?:string};
export type PolicyDecision={decision:DecisionValue;effect:PolicyEffect;policyId:string;policyVersion:number;matchedRuleIds:string[];obligations:Obligation[];explanation:string;provisional:boolean;evaluatorVersion:string;durationMs:number;missingFacts:string[]};

const MAX_DEPTH=6,MAX_GROUPS=64,MAX_CONDITIONS=256;
const setOf=<T extends string>(values:readonly T[])=>new Set<string>(values);
const operators=setOf(POLICY_OPERATORS),effects=setOf(POLICY_EFFECTS),sources=setOf(OPERAND_SOURCES);
const forbiddenKey=/(javascript|script|sql|query|eval|function|http|url|webhook|secret|token|password)/i;

function scalar(value:TypedValue|undefined):string|boolean|string[]|undefined{return value?.value}
function numeric(value:unknown){const text=String(value);if(!/^-?\d+(\.\d+)?$/.test(text))throw new Error("INVALID_NUMERIC_OPERAND");const negative=text.startsWith("-"),clean=negative?text.slice(1):text,[whole,fraction=""]=clean.split("."),digits=`${whole.replace(/^0+(?=\d)/,"")}${(fraction+"0".repeat(12)).slice(0,12)}`.replace(/^0+/,"")||"0";return{sign:digits==="0"?0:negative?-1:1,digits}}
function compareNumeric(a:unknown,b:unknown){const left=numeric(a),right=numeric(b);if(left.sign!==right.sign)return left.sign<right.sign?-1:1;if(left.sign===0)return 0;const magnitude=left.digits.length===right.digits.length?(left.digits===right.digits?0:left.digits<right.digits?-1:1):left.digits.length<right.digits.length?-1:1;return left.sign<0?-magnitude:magnitude}
function time(value:unknown){const result=Date.parse(String(value));if(Number.isNaN(result))throw new Error("INVALID_DATE_OPERAND");return result}
function compare(a:TypedValue|undefined,b:TypedValue|undefined,operator:PolicyOperator,c?:TypedValue){
  if(operator==="exists")return a!==undefined;if(operator==="not_exists")return a===undefined;if(a===undefined)return false;
  const av=scalar(a),bv=scalar(b);
  if(operator==="equals")return JSON.stringify(av)===JSON.stringify(bv);
  if(operator==="not_equals")return JSON.stringify(av)!==JSON.stringify(bv);
  if(operator==="in"||operator==="not_in"){const list=Array.isArray(bv)?bv:[String(bv??"")],hit=list.includes(String(av));return operator==="in"?hit:!hit}
  if(operator==="contains")return Array.isArray(av)?av.includes(String(bv)):String(av).includes(String(bv));
  if(operator==="starts_with")return String(av).startsWith(String(bv));if(operator==="ends_with")return String(av).endsWith(String(bv));
  const dates=operator.startsWith("date_"),cmp=dates?Math.sign(time(av)-time(bv)):compareNumeric(av,bv);
  if(operator==="greater_than"||operator==="date_after")return cmp>0;if(operator==="greater_or_equal")return cmp>=0;
  if(operator==="less_than"||operator==="date_before")return cmp<0;if(operator==="less_or_equal")return cmp<=0;
  if(operator==="between"||operator==="date_between"){const upper=dates?Math.sign(time(av)-time(scalar(c))):compareNumeric(av,scalar(c));return cmp>=0&&upper<=0}
  return false;
}

function resolve(operand:Operand|undefined,context:EvaluationContext,missing:Set<string>):TypedValue|undefined{
  if(!operand)return undefined;if(operand.source==="static_value")return operand.value;if(operand.source==="current_time")return{type:"datetime",value:context.now||new Date().toISOString()};
  if(operand.source==="policy_parameter"){const value=context.parameters?.[operand.key||""];if(!value&&operand.key)missing.add(`parameter:${operand.key}`);return value}
  const value=context.facts[`${operand.source}:${operand.key}`]??context.facts[operand.key||""];if(!value&&operand.key)missing.add(`${operand.source}:${operand.key}`);return value;
}
function evaluateCondition(condition:Condition,context:EvaluationContext,missing:Set<string>){return compare(resolve(condition.left,context,missing),resolve(condition.right,context,missing),condition.operator,resolve(condition.right2,context,missing))}
function evaluateGroup(group:ConditionGroup,context:EvaluationContext,missing:Set<string>):boolean{const values=[...group.conditions.map(x=>evaluateCondition(x,context,missing)),...(group.groups||[]).map(x=>evaluateGroup(x,context,missing))];if(group.mode==="all")return values.every(Boolean);if(group.mode==="any")return values.some(Boolean);return values.every(x=>!x)}

export function validatePolicy(policy:Policy){
  const issues:string[]=[];let groups=0,conditions=0;
  if(!policy.id||!policy.key)issues.push("identity_required");if(!POLICY_TYPES.includes(policy.policyType))issues.push("invalid_policy_type");if(!effects.has(policy.defaultEffect))issues.push("invalid_default_effect");
  if(policy.status==="active"&&policy.rules.length===0)issues.push("active_policy_requires_rules");if(["high","critical"].includes(policy.risk)&&policy.failMode==="fail_open")issues.push("high_risk_cannot_fail_open");
  const visit=(group:ConditionGroup,depth:number)=>{groups++;if(depth>MAX_DEPTH)issues.push("max_depth_exceeded");if(!["all","any","none"].includes(group.mode))issues.push(`invalid_group_mode:${group.id}`);for(const condition of group.conditions){conditions++;if(!operators.has(condition.operator))issues.push(`invalid_operator:${condition.id}`);for(const operand of[condition.left,condition.right,condition.right2])if(operand){if(!sources.has(operand.source))issues.push(`invalid_source:${condition.id}`);if(operand.key&&forbiddenKey.test(operand.key))issues.push(`forbidden_operand:${condition.id}`)}}for(const child of group.groups||[])visit(child,depth+1)};
  for(const rule of policy.rules){if(!effects.has(rule.effect))issues.push(`invalid_effect:${rule.id}`);visit(rule.conditions,1)}
  if(groups>MAX_GROUPS)issues.push("max_groups_exceeded");if(conditions>MAX_CONDITIONS)issues.push("max_conditions_exceeded");
  return{valid:issues.length===0,issues,complexity:{groups,conditions,depthLimit:MAX_DEPTH}};
}
const effectDecision:Record<PolicyEffect,DecisionValue>={allow:"allow",deny:"deny",require_approval:"require_approval",warn:"warn",route:"allow_with_conditions",set_limit:"allow_with_conditions",require_review:"require_review",no_op:"not_applicable"};
function failure(policy:Policy,missing:string[],started:number):PolicyDecision{const effect=policy.failMode==="fail_open"?"allow":policy.failMode==="require_manual_review"?"require_review":policy.failMode==="default_effect"?policy.defaultEffect:"deny";return{decision:effectDecision[effect],effect,policyId:policy.id,policyVersion:policy.version,matchedRuleIds:[],obligations:effect==="require_review"?[{type:"review",target:"manual"}]:[],explanation:`Evaluation incomplete: ${missing.join(", ")||"invalid policy"}. Applied ${policy.failMode}.`,provisional:false,evaluatorVersion:policy.evaluatorVersion,durationMs:Date.now()-started,missingFacts:missing}}

export function evaluatePolicy(policy:Policy,context:EvaluationContext):PolicyDecision{
  const started=Date.now(),validation=validatePolicy(policy);if(!validation.valid)return failure(policy,validation.issues,started);if(context.offline&&!policy.offlineSafe)return failure(policy,["offline_not_allowed"],started);
  const missing=new Set<string>(),matches=[...policy.rules].filter(x=>x.enabled).sort((a,b)=>b.priority-a.priority).filter(rule=>evaluateGroup(rule.conditions,context,missing));
  if(missing.size&&["high","critical"].includes(policy.risk))return failure(policy,[...missing],started);
  let selected:Rule[]=[];
  if(policy.evaluationMode==="all_match")selected=matches;else if(policy.evaluationMode==="deny_overrides")selected=matches.some(x=>x.effect==="deny")?matches.filter(x=>x.effect==="deny"):matches;else if(policy.evaluationMode==="allow_overrides")selected=matches.some(x=>x.effect==="allow")?matches.filter(x=>x.effect==="allow"):matches;else selected=matches.slice(0,1);
  if(!selected.length){const effect=policy.defaultEffect;return{decision:effectDecision[effect],effect,policyId:policy.id,policyVersion:policy.version,matchedRuleIds:[],obligations:[],explanation:"No rule matched; versioned default effect applied.",provisional:Boolean(context.offline),evaluatorVersion:policy.evaluatorVersion,durationMs:Date.now()-started,missingFacts:[...missing]}}
  const effect=selected.some(x=>x.effect==="deny")?"deny":selected.some(x=>x.effect==="require_approval")?"require_approval":selected.some(x=>x.effect==="require_review")?"require_review":selected[0].effect;
  return{decision:effectDecision[effect],effect,policyId:policy.id,policyVersion:policy.version,matchedRuleIds:selected.map(x=>x.id),obligations:selected.flatMap(x=>x.obligations||[]),explanation:selected.map(x=>x.explanation).join(" "),provisional:Boolean(context.offline),evaluatorVersion:policy.evaluatorVersion,durationMs:Date.now()-started,missingFacts:[...missing]};
}

export function evaluateMany(policies:Policy[],context:EvaluationContext){return policies.filter(x=>x.status==="active"&&scopeApplies(x,context.scopeChain||[])).sort((a,b)=>b.scope.precedence-a.scope.precedence).map(x=>evaluatePolicy(x,context))}
export function scopeApplies(policy:Policy,chain:Array<{type:ScopeType;id?:string}>){return policy.scope.type==="global"||chain.some(x=>x.type===policy.scope.type&&(!policy.scope.id||x.id===policy.scope.id))}
export function resolveDecision(decisions:PolicyDecision[]){if(!decisions.length)return{decision:"not_applicable" as DecisionValue,source:null};const deny=decisions.find(x=>x.decision==="deny"),approval=decisions.find(x=>x.decision==="require_approval"),review=decisions.find(x=>x.decision==="require_review");return{decision:(deny||approval||review||decisions[0]).decision,source:(deny||approval||review||decisions[0]).policyId,obligations:decisions.flatMap(x=>x.obligations)}}
export function detectShadowedRules(policy:Policy){const seen=new Set<string>(),shadowed:string[]=[];for(const rule of[...policy.rules].sort((a,b)=>b.priority-a.priority)){const signature=JSON.stringify(rule.conditions);if(seen.has(signature))shadowed.push(rule.id);seen.add(signature)}return shadowed}
export function detectDependencyCycle(edges:Array<{from:string;to:string}>){const graph=new Map<string,string[]>();for(const e of edges)graph.set(e.from,[...(graph.get(e.from)||[]),e.to]);const visiting=new Set<string>(),done=new Set<string>();const visit=(node:string):boolean=>{if(visiting.has(node))return true;if(done.has(node))return false;visiting.add(node);for(const next of graph.get(node)||[])if(visit(next))return true;visiting.delete(node);done.add(node);return false};return[...graph.keys()].some(visit)}
export type DecisionRow={id:string;priority:number;min?:string;max?:string;values?:string[];effect:PolicyEffect};
export function validateDecisionTable(rows:DecisionRow[]){const issues:string[]=[];const ordered=[...rows].sort((a,b)=>a.priority-b.priority);for(let i=0;i<ordered.length;i++)for(let j=i+1;j<ordered.length;j++){const a=ordered[i],b=ordered[j];if(a.min!=null&&a.max!=null&&b.min!=null&&b.max!=null&&compareNumeric(a.min,b.max)<=0&&compareNumeric(b.min,a.max)<=0)issues.push(`overlap:${a.id}:${b.id}`);if(a.values?.some(x=>b.values?.includes(x)))issues.push(`overlap:${a.id}:${b.id}`)}return{valid:issues.length===0,issues}}
export function effectiveExceptions<T extends {status:string;validFrom:string;validUntil:string;scopePrecedence:number}>(items:T[],now=new Date()){const timestamp=now.getTime();return items.filter(x=>x.status==="active"&&Date.parse(x.validFrom)<=timestamp&&Date.parse(x.validUntil)>timestamp).sort((a,b)=>b.scopePrecedence-a.scopePrecedence)}
export function publicationReadiness(input:{policy:Policy;tests:{passed:number;failed:number;coverage:number};impactReviewed:boolean;approvalStatus:string;hasUnresolvedConflicts:boolean}){const issues=[...validatePolicy(input.policy).issues];if(input.tests.failed>0||input.tests.passed===0)issues.push("tests_not_green");if(input.tests.coverage<80)issues.push("coverage_below_80");if(!input.impactReviewed)issues.push("impact_not_reviewed");if(["high","critical"].includes(input.policy.risk)&&input.approvalStatus!=="approved")issues.push("approval_required");if(input.hasUnresolvedConflicts)issues.push("unresolved_conflicts");return{publishable:issues.length===0,issues}}
export function auditStrategy(policy:Pick<Policy,"risk"|"auditMode">,evaluationsPerHour:number){if(policy.risk==="critical")return{mode:"full",sampleRate:1};if(policy.auditMode==="full"&&evaluationsPerHour>10000)return{mode:"sampled",sampleRate:.01,aggregate:true};if(policy.auditMode==="sampled")return{mode:"sampled",sampleRate:Math.max(.01,Math.min(1,1000/Math.max(1,evaluationsPerHour))),aggregate:true};return{mode:policy.auditMode,sampleRate:policy.auditMode==="none"?0:1,aggregate:policy.auditMode==="aggregate"}}

export const POLICY_PERMISSIONS=["policies:view","policies:create","policies:edit","policies:test","policies:simulate","policies:request_approval","policies:approve","policies:publish","policies:rollback","policies:manage_exceptions","policies:view_decisions","policies:view_analytics","policies:manage_facts","policies:manage_settings"] as const;
export const POLICY_EVENTS=["policy.created","policy.version_created","policy.validation_failed","policy.test_failed","policy.approval_requested","policy.approved","policy.published","policy.rolled_back","policy.exception_created","policy.exception_expired","policy.decision_sampled","policy.health_degraded"] as const;
export const POLICY_COPILOT_TOOLS=["explainPolicy","simulatePolicy","comparePolicyVersions","listImpactedScopes","explainDecision","draftPolicy","suggestTestCases","findPolicyConflicts"] as const;
export const POLICY_BOUNDARIES={executesActions:false,grantsPermissions:false,changesBilling:false,publishesAiDrafts:false,replacesDomainInvariants:false,approvalEngine:"internal_approvals",actionEngine:"copilot_action_requests",safeDefinition:"typed_ast_only"} as const;
