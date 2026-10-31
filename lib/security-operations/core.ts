/* Security Operations Center: typed, explainable and side-effect-safe domain services. */
export const SOC_CONTEXTS=["platform_soc","tenant_soc"] as const;
export const SECURITY_EVENT_TYPES=["auth","session","mfa","privilege","access_change","data_access","data_export","api","webhook","integration","config_change","policy_change","feature_change","service_account","vendor_access","audit","security_control","automation","AI_action","infrastructure","custom"] as const;
export const EVENT_QUALITY=["authoritative","derived","reconstructed","partial","unknown"] as const;
export const DETECTION_TYPES=["threshold","sequence","correlation","anomaly_baseline","impossible_state","known_bad_pattern_internal","policy_violation","control_failure","custom_safe"] as const;
export const DETECTION_PRIMITIVES=["count","distinct_count","time_window","threshold","sequence","equals","in","not_in","greater_than","less_than","scope_match","actor_match","entitlement_match","change_context","incident_context","provider_context"] as const;
export const ALERT_DISPOSITIONS=["confirmed_security_incident","benign_expected_activity","false_positive","policy_violation","control_failure","suspicious_unconfirmed","duplicate","insufficient_evidence"] as const;
export const SOC_PERMISSIONS=["soc:view","soc:view_sensitive","soc:view_platform","soc:view_tenant","soc:view_events","soc:view_identity_context","soc:create_investigation","soc:manage_investigation","soc:manage_detection_rules","soc:test_detection_rules","soc:run_hunts","soc:acknowledge_alert","soc:disposition_alert","soc:request_response","soc:execute_response","soc:execute_emergency_response","soc:manage_suppressions","soc:view_network","soc:manage_governance","soc:approve_critical_response","soc:manage_critical_detection"] as const;
export const SOC_COPILOT_TOOLS=["getSecurityOverview","getSecurityAlert","getSecurityInvestigation","getSecurityTimeline","getIdentitySecurityContext","getPrivilegedSecurityEvents","getAPISecuritySignals","getIntegrationSecuritySignals","getDetectionRule","getDetectionCoverage","getSecurityResponseOptions","getSecurityEventSourceHealth","summarizeSecurityEvidence"] as const;
export const RESPONSE_TYPES=["revoke_session","revoke_temporary_access","disable_identity","suspend_privileged_entitlement","revoke_api_token","disable_integration_credential","pause_integration","restrict_vendor_access","require_reauthentication","force_mfa_reset","block_api_client","isolate_automation","pause_agent_tool_permission","trigger_credential_rotation","place_sensitive_access_hold","enable_feature_kill_switch","request_access_review","create_incident","create_change","notify_owner"] as const;

type EventInput={organizationId?:string|null;context:"platform_soc"|"tenant_soc";eventType:string;sourceDomain:string;sourceRef:string;sourceEventId?:string;actorIdentityRef?:string;targetEntityType?:string;targetEntityRef?:string;eventTime:string;quality?:string;metadataRef?:Record<string,unknown>};
const secretKey=/secret|password|token_value|authorization|cookie|otp|card_number|credential_value/i;
const redact=(value:unknown):unknown=>Array.isArray(value)?value.map(redact):value&&typeof value==="object"?Object.fromEntries(Object.entries(value as Record<string,unknown>).map(([k,v])=>[k,secretKey.test(k)?"[redacted]":redact(v)])):value;

export class SecurityEventIngestionService{
  normalize(input:EventInput){
    if(!SOC_CONTEXTS.includes(input.context)||!SECURITY_EVENT_TYPES.includes(input.eventType as never))throw new Error("SECURITY_EVENT_SCHEMA_INVALID");
    if(input.context==="tenant_soc"&&!input.organizationId)throw new Error("TENANT_SCOPE_REQUIRED");
    const dedupKey=[input.sourceDomain,input.sourceRef,input.sourceEventId||input.eventTime].join("|");
    return{...input,eventQuality:EVENT_QUALITY.includes((input.quality||"unknown") as never)?input.quality:"unknown",metadataRef:redact(input.metadataRef||{}),dedupKey,rawPayloadCopied:false,ingestionMode:"at_least_once",idempotent:true};
  }
}
export class SecurityEventSourceHealthService{
  check(input:{enabled:boolean;lastEventAt?:string;freshnessMinutes:number;parseFailures?:number;droppedEvents?:number;schemaCompatible?:boolean},now=new Date()){
    if(!input.enabled)return{status:"disabled",healthy:false,reasons:["SOURCE_DISABLED"]};
    const age=input.lastEventAt?(now.getTime()-Date.parse(input.lastEventAt))/60000:Infinity,reasons:string[]=[];
    if(age>input.freshnessMinutes)reasons.push("SOURCE_STALE");if(input.schemaCompatible===false)reasons.push("SCHEMA_INCOMPATIBLE");if((input.parseFailures||0)>0)reasons.push("PARSE_FAILURES");if((input.droppedEvents||0)>0)reasons.push("DROPPED_EVENTS");
    return{status:reasons.length?"degraded":"healthy",healthy:reasons.length===0,reasons,ageMinutes:Number.isFinite(age)?Math.max(0,Math.round(age)):null,missingTelemetryIsHealthy:false};
  }
}

export type DetectionExpression={primitive:string;field?:string;value?:unknown;threshold?:number;windowSeconds?:number;steps?:DetectionExpression[];conditions?:DetectionExpression[]};
const forbidden=/(eval|javascript|sql|select\s|insert\s|update\s|delete\s|http|fetch|network|function|secret|password)/i;
export class SafeDetectionDSL{
  validate(expression:DetectionExpression,depth=0):{valid:boolean;issues:string[]}{
    const issues:string[]=[];if(depth>8)issues.push("MAX_DEPTH_EXCEEDED");if(!DETECTION_PRIMITIVES.includes(expression.primitive as never))issues.push("PRIMITIVE_NOT_ALLOWED");
    if(expression.field&&forbidden.test(expression.field))issues.push("FORBIDDEN_FIELD");if(typeof expression.value==="string"&&forbidden.test(expression.value))issues.push("FORBIDDEN_VALUE");
    for(const child of[...(expression.steps||[]),...(expression.conditions||[])])issues.push(...this.validate(child,depth+1).issues);
    if((expression.steps?.length||0)+(expression.conditions?.length||0)>64)issues.push("TOO_MANY_NODES");
    return{valid:issues.length===0,issues:[...new Set(issues)]};
  }
}
type SecurityEvent={eventType:string;eventTime:string;actorIdentityRef?:string;targetEntityRef?:string;metadata?:Record<string,unknown>};
export class SecurityDetectionTestService{
  run(rule:{type:string;expression:DetectionExpression},events:SecurityEvent[]){const validation=new SafeDetectionDSL().validate(rule.expression);if(!validation.valid)return{matched:[],missingData:[],issues:validation.issues,productionSideEffects:false};const matched=this.evaluate(rule,events);return{matched,matchCount:matched.length,falsePositiveCandidates:[],missingData:[],issues:[],productionSideEffects:false,expectedCoverage:"explicit_sources_only"}}
  replay(rule:{type:string;expression:DetectionExpression},events:SecurityEvent[],days=7){return{...this.run(rule,events),windowDays:Math.max(1,Math.min(90,days)),mode:"historical_read_only",alertsCreated:0}}
  private evaluate(rule:{type:string;expression:DetectionExpression},events:SecurityEvent[]){const exp=rule.expression;if(rule.type==="threshold"){const count=events.filter(e=>!exp.field||e.eventType===exp.field).length;return count>=Number(exp.threshold||1)?events:[]}if(rule.type==="sequence"){let cursor=0;for(const e of events)if(e.eventType===exp.steps?.[cursor]?.field)cursor++;return cursor===(exp.steps?.length||0)?events:[]}return events.filter(e=>e.eventType===exp.field)}
}
export class SecurityDetectionVersionService{create(input:{key:string;previousVersion?:number;expression:DetectionExpression;status?:string}){const validation=new SafeDetectionDSL().validate(input.expression);if(!validation.valid)throw new Error(validation.issues.join(","));return{key:input.key,version:(input.previousVersion||0)+1,status:input.status||"draft",immutable:true,expression:input.expression,historicalVersionsRewritten:false}}}
export class SecurityDetectionCoverageService{map(input:{expected:string[];covered:string[];healthySources:string[]}){const covered=new Set(input.covered),healthy=new Set(input.healthySources);return{items:input.expected.map(x=>({control:x,covered:covered.has(x),sourceHealthy:healthy.has(x),state:!covered.has(x)?"gap":healthy.has(x)?"covered":"degraded"})),certificationClaim:false}}}

export class SecurityCorrelationService{
  correlate(events:Array<SecurityEvent&{id:string;organizationId?:string;sessionRef?:string;serviceRef?:string}>,windowMinutes=30){const sorted=[...events].sort((a,b)=>Date.parse(a.eventTime)-Date.parse(b.eventTime)),groups:typeof events[]=[];for(const event of sorted){const group=groups.find(g=>g.some(x=>x.organizationId===event.organizationId&&(x.actorIdentityRef&&x.actorIdentityRef===event.actorIdentityRef||x.sessionRef&&x.sessionRef===event.sessionRef||x.targetEntityRef&&x.targetEntityRef===event.targetEntityRef)&&Math.abs(Date.parse(x.eventTime)-Date.parse(event.eventTime))<=windowMinutes*60000));group?group.push(event):groups.push([event])}return groups.map((g,i)=>({key:`correlation-${i+1}`,eventIds:g.map(x=>x.id),signalCount:g.length,confidence:g.length>=3?"high":g.length===2?"medium":"low",causalityConfirmed:false,boundedWindowMinutes:windowMinutes}))}
}
export class SecurityAlertNoiseReductionService{
  decide(input:{fingerprint:string;severity:string;existingFingerprints:string[];suppression?:{expiresAt:string;reason:string};approvedChange?:boolean;criticalSignal?:boolean}){const duplicate=input.existingFingerprints.includes(input.fingerprint),activeSuppression=Boolean(input.suppression&&Date.parse(input.suppression.expiresAt)>Date.now());return{duplicate,aggregate:duplicate,suppressed:activeSuppression&&!input.criticalSignal,changeContext:input.approvedChange?"related_approved_change":null,criticalSignalHidden:false,autoClosed:false}}
}
export class SecurityAlertPriorityService{prioritize(input:{severity:string;criticality?:string;privileged?:boolean;scope?:string;confidence?:string;activeImpact?:boolean}){const reasons=[`severity:${input.severity}`];let rank={info:1,low:2,medium:3,high:4,critical:5}[input.severity]||1;if(input.privileged){rank++;reasons.push("privileged_identity")}if(input.criticality==="critical"){rank++;reasons.push("critical_resource")}if(input.activeImpact){rank++;reasons.push("active_impact")}return{priority:["P4","P4","P3","P2","P1","P1","P1"][Math.min(6,rank)],reasons,opaqueScore:false,confidence:input.confidence||"unknown"}}}

export class SecurityInvestigationService{
  create(input:{title:string;alertRefs:string[];owner?:string;severity:string}){if(!input.title||!input.alertRefs.length)throw new Error("INVESTIGATION_EVIDENCE_REQUIRED");return{...input,status:"open",containmentState:"none",facts:[],hypotheses:[],incidentRef:null,alertHistoryPreserved:true}}
  hypothesis(input:{statement:string;evidenceFor?:string[];evidenceAgainst?:string[];status?:string}){return{...input,status:input.status||"open",confirmedFact:false,privateChainOfThought:false}}
  close(input:{conclusion?:string;evidenceRefs:string[];disposition?:string}){if(!input.conclusion||!input.disposition)throw new Error("INVESTIGATION_CONCLUSION_REQUIRED");return{status:"closed",...input,evidenceDeleted:false,historyPreserved:true}}
}
export class SecurityIncidentBridgeService{candidate(input:{investigationRef:string;disposition:string;evidenceSummary:string;affectedRefs:string[]}){return{...input,createOperationalIncident:input.disposition==="confirmed_security_incident",phase59Authoritative:true,incidentAutomaticallyConfirmed:false}}}
export class SecurityChangeContextService{enrich(input:{eventTime:string;actorRef?:string;resourceRef?:string;changes:Array<{id:string;startsAt:string;endsAt:string;actorRefs?:string[];resourceRefs?:string[]}>}){const time=Date.parse(input.eventTime),matches=input.changes.filter(c=>Date.parse(c.startsAt)<=time&&Date.parse(c.endsAt)>=time&&(!c.actorRefs?.length||c.actorRefs.includes(input.actorRef||""))&&(!c.resourceRefs?.length||c.resourceRefs.includes(input.resourceRef||"")));return{relatedChangeRefs:matches.map(x=>x.id),automaticSuppression:false,criticalSignalsRemainVisible:true}}}

const highImpact=new Set(["disable_identity","suspend_privileged_entitlement","revoke_api_token","pause_integration","block_api_client","trigger_credential_rotation","enable_feature_kill_switch"]);
export class SecurityResponseOrchestrationService{
  propose(input:{actionType:string;scopeRef:string;evidenceRefs:string[];investigationRef?:string;emergency?:boolean;confidence?:string;policyAllowsEmergency?:boolean}){if(!RESPONSE_TYPES.includes(input.actionType as never))throw new Error("RESPONSE_NOT_ALLOWED");if(!input.evidenceRefs.length)throw new Error("RESPONSE_EVIDENCE_REQUIRED");const impactful=highImpact.has(input.actionType),emergencyAllowed=Boolean(input.emergency&&input.policyAllowsEmergency&&input.confidence==="high"&&input.investigationRef);return{...input,state:impactful&&!emergencyAllowed?"awaiting_approval":"proposed",policyEngineRequired:impactful,actionEngineRequired:true,previewRequired:!emergencyAllowed,emergencyAllowed,directMutation:false,verificationRequired:true}}
  verify(input:{expectedState:string;actualState?:string}){const verified=Boolean(input.actualState&&input.actualState===input.expectedState);return{verified,state:verified?"completed":"failed",failureReason:verified?null:"SOURCE_STATE_NOT_VERIFIED"}}
}
export class SecurityAccessService{check(input:{context:string;organizationId?:string;resourceOrganizationId?:string;superAdmin?:boolean;permissions:string[];required:string;sensitive?:boolean}){const scope=input.context==="platform_soc"?input.superAdmin===true:Boolean(input.organizationId&&input.organizationId===input.resourceOrganizationId),permission=input.permissions.includes(input.required),sensitiveAllowed=!input.sensitive||input.permissions.includes("soc:view_sensitive");return{allowed:scope&&permission&&sensitiveAllowed,tenantIsolated:scope,masked:!sensitiveAllowed,grantsAuthAdmin:false}}}
export class SecurityOperationsHealthService{check(checks:Record<string,boolean>){const failures=Object.entries(checks).filter(([,ok])=>!ok).map(([name])=>name);return{status:failures.length?"degraded":"healthy",failures,authBlocked:false,ordersBlocked:false,paymentsBlocked:false,sourceControlsRemainActive:true,catchUpEnabled:true}}}
export function securityCopilot(tool:string,input:unknown){if(!SOC_COPILOT_TOOLS.includes(tool as never))throw new Error("SOC_COPILOT_TOOL_NOT_ALLOWED");return{tool,input,sections:["observation","evidence","context","identity_access","affected_resources","correlation","hypotheses","confidence","available_response","next_steps"],classifications:["confirmed_fact","rule_match","correlation","hypothesis","unknown"],canDeclareCompromise:false,canExecuteContainment:false,canRevealSecrets:false,canCloseInvestigation:false}}
