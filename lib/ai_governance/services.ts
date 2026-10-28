import{AIAgentSimulationService,AIGovernanceHealthService,AIToolAuthorizationService,AI_GOVERNANCE_BOUNDARIES,type AuthorizationInput}from"./core";
export const DEFAULT_RUN_LIMITS={maxSteps:16,maxToolCalls:10,maxModelCalls:8,maxRuntimeMs:120000,maxCost:2,maxHandoffDepth:3,maxChildRuns:6,maxToolRepairAttempts:1};
export const HIGH_RISK_DOMAINS=["payments","refunds","fiscal","payroll","security","financial_adjustments","quality_release","policy_change"]as const;
export const RED_TEAM_SCENARIOS=["prompt_injection","malicious_knowledge","user_pretending_admin","tool_parameter_injection","fake_order_id","cross_tenant_request","endless_task","expensive_recursive_task","tool_output_injection","data_exfiltration"]as const;
export function authorizeTool(input:AuthorizationInput){return new AIToolAuthorizationService().authorize(input)}
export function simulateAgent(input:Parameters<AIAgentSimulationService["simulate"]>[0]){return new AIAgentSimulationService().simulate(input)}
export function governanceHealth(input:Parameters<AIGovernanceHealthService["check"]>[0]){return new AIGovernanceHealthService().check(input)}
export function degradedModeFor(reason:string){if(/provider|model/.test(reason))return{mode:"human_or_static_fallback",customerMessage:"A assistência por IA está temporariamente indisponível. O atendimento humano e os pedidos continuam funcionando.",coreOrderingAvailable:true};if(/budget/.test(reason))return{mode:"human_review",coreOrderingAvailable:true};return{mode:"read_only",coreOrderingAvailable:true}}
export const SERVICE_BOUNDARIES=AI_GOVERNANCE_BOUNDARIES;
