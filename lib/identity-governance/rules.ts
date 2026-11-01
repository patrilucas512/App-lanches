/* eslint-disable @typescript-eslint/no-explicit-any */
/* Pure rules for requests, temporary access, break-glass, lifecycle, SoD, reviews, reconciliation and findings. */
import {AccessPriorityService,EXTERNAL_TYPES,NON_HUMAN_TYPES,type Criticality,type EffectiveEntry} from "./core.ts";

export const hoursOfInterval=(value:string|null|undefined):number|null=>{if(!value)return null;const days=/(\d+)\s*day/.exec(value),hours=/(\d+)\s*hour/.exec(value),clock=/(\d+):(\d+):(\d+)/.exec(value);if(!days&&!hours&&!clock)return null;return Number(days?.[1]||0)*24+Number(hours?.[1]||0)+(clock?Number(clock[1])+Number(clock[2])/60:0)};

export type PolicyGate={decision:string;source?:string|null;available:boolean};
export class AccessRequestService{
  validate(input:{entitlement:{requestable:boolean;status:string;privileged:boolean;requires_justification:boolean;max_duration?:string|null;technical_ref?:{adapter?:string}};justification?:string;durationHours?:number|null;requestType:string}){
    const issues:string[]=[],e=input.entitlement,max=hoursOfInterval(e.max_duration);
    if(input.requestType!=="removal"&&(!e.requestable||e.status!=="active"))issues.push("ENTITLEMENT_NOT_REQUESTABLE");
    if(input.requestType!=="removal"&&e.technical_ref?.adapter==="read_only")issues.push("NO_OFFICIAL_PATH");
    if(e.requires_justification&&(input.justification||"").trim().length<10)issues.push("JUSTIFICATION_REQUIRED");
    // New privileged access is temporary by default; there is no permanent path through a request.
    if(input.requestType!=="removal"&&e.privileged&&!input.durationHours)issues.push("DURATION_REQUIRED_FOR_PRIVILEGED");
    if(input.durationHours&&(!Number.isInteger(input.durationHours)||input.durationHours<1))issues.push("DURATION_INVALID");
    if(["extension","temporary","jit"].includes(input.requestType)&&!input.durationHours)issues.push("DURATION_REQUIRED");
    if(max&&input.durationHours&&input.durationHours>max)issues.push("DURATION_EXCEEDS_MAXIMUM");
    return{valid:issues.length===0,issues};
  }
  // Roles of approvers are not named here: whoever holds idgov:approve_access decides, and the policy may raise the bar.
  route(input:{criticality:Criticality;privileged:boolean;policy:PolicyGate;sodResult?:string;environmentAccess?:boolean;productionRequiresChange?:boolean}){
    const reasons=[`criticidade:${input.criticality}`];
    if(input.policy.decision==="deny")return{outcome:"deny" as const,requiredApprovals:0,requiresChange:false,riskLevel:input.criticality,reasons:[...reasons,"política_negou"]};
    let required=input.criticality==="critical"?2:1;
    if(input.criticality==="critical")reasons.push("aprovação_dupla");
    if(input.sodResult==="conflict_mitigated"||input.sodResult==="conflict_accepted"){required=Math.max(required,2);reasons.push("conflito_sod_tratado")}
    if(input.policy.decision==="allow"&&!input.privileged&&["low","medium"].includes(input.criticality)&&!input.sodResult?.startsWith("conflict")){required=0;reasons.push("pré_aprovado_por_política")}
    if(!input.policy.available&&input.privileged)reasons.push("política_indisponível_aprovação_mantida");
    return{outcome:"approval" as const,requiredApprovals:required,requiresChange:Boolean(input.environmentAccess&&input.productionRequiresChange),riskLevel:input.criticality,reasons};
  }
  canApprove(input:{approverId:string;requesterId:string;beneficiaryUserId?:string|null;alreadyApproved?:string[]}){const reasons:string[]=[];if(input.approverId===input.requesterId||input.approverId===input.beneficiaryUserId)reasons.push("SELF_APPROVAL_BLOCKED");if(input.alreadyApproved?.includes(input.approverId))reasons.push("ALREADY_DECIDED");return{allowed:reasons.length===0,reasons}}
}

export class TemporaryAccessService{
  plan(grants:Array<{id:string;status:string;valid_until?:string|null}>,now:Date,warnHours:number){const expire:string[]=[],warn:string[]=[],t=now.getTime(),limit=t+warnHours*3600_000;for(const g of grants){if(!g.valid_until||!["active","expiring","failed"].includes(g.status))continue;const until=Date.parse(g.valid_until);if(until<=t)expire.push(g.id);else if(g.status==="active"&&until<=limit)warn.push(g.id)}return{expire,warn}}
  extend(input:{newValidUntil?:string|null;now?:Date}){if(!input.newValidUntil)throw new Error("PERMANENT_EXTENSION_REQUIRES_REVIEW");if(Date.parse(input.newValidUntil)<=(input.now||new Date()).getTime())throw new Error("EXTENSION_IN_THE_PAST");return{validUntil:input.newValidUntil,newRequestRequired:true}}
}
const JIT_TRANSITIONS:Record<string,string[]>={requested:["approved","revoked"],approved:["active","revoked"],active:["expired","revoked"],expired:[],revoked:[]};
export class JitAccessService{
  transition(from:string,to:string){if(!JIT_TRANSITIONS[from]?.includes(to))throw new Error(`JIT_INVALID_TRANSITION:${from}:${to}`);return to}
  validate(input:{minutes:number;maxMinutes:number;entitlementMaxHours?:number|null;justification?:string}){const issues:string[]=[];if(!(input.minutes>0)||input.minutes>input.maxMinutes)issues.push("JIT_WINDOW_EXCEEDED");if(input.entitlementMaxHours&&input.minutes/60>input.entitlementMaxHours)issues.push("JIT_WINDOW_EXCEEDS_ENTITLEMENT");if((input.justification||"").trim().length<10)issues.push("JUSTIFICATION_REQUIRED");return{valid:issues.length===0,issues}}
  preApproved(input:{key:string;preApprovedKeys:string[];criticality:string}){return input.criticality!=="critical"&&input.preApprovedKeys.includes(input.key)}
  mfaSatisfied(input:{privileged:boolean;requireMfa:boolean;aal?:string|null}){return!input.privileged||!input.requireMfa||input.aal==="aal2"}
}
export class BreakGlassService{
  validate(input:{reason?:string;minutes:number;maxMinutes:number;requiresIncident:boolean;incidentRef?:string|null;adapter?:string;scopeKey?:string}){const issues:string[]=[];if((input.reason||"").trim().length<10)issues.push("REASON_REQUIRED");if(!(input.minutes>0)||input.minutes>input.maxMinutes)issues.push("BREAK_GLASS_WINDOW_EXCEEDED");if(input.requiresIncident&&!input.incidentRef)issues.push("INCIDENT_REQUIRED");if(!input.adapter||input.adapter==="read_only")issues.push("NO_OFFICIAL_PATH");if(!input.scopeKey)issues.push("SCOPE_REQUIRED");return{valid:issues.length===0,issues}}
  canReview(input:{reviewerId:string;usedBy?:string|null;status:string}){const reasons:string[]=[];if(input.reviewerId===input.usedBy)reasons.push("REVIEWER_MUST_DIFFER");if(!["expired","closed","under_review"].includes(input.status))reasons.push("NOT_READY_FOR_REVIEW");return{allowed:reasons.length===0,reasons}}
  // A use outside the scope is a signal for the SOC to look at; it is never recorded as abuse here.
  reviewOutcome(outcome:string){return{finding:outcome!=="appropriate",socSignal:outcome==="out_of_scope_signal",abuseDeclared:false}}
}
export class AccessLifecycleService{
  moverPlan(input:{current:Array<{id:string;entitlement_id:string;scope_key:string;source_type:string}>;target:Array<{entitlement_id:string;scope_key:string}>}){const key=(x:{entitlement_id:string;scope_key:string})=>`${x.entitlement_id}|${x.scope_key}`,target=new Set(input.target.map(key)),current=new Set(input.current.map(key));return{remove:input.current.filter(x=>!target.has(key(x))).map(x=>x.id),add:input.target.filter(x=>!current.has(key(x))),keep:input.current.filter(x=>target.has(key(x))).map(x=>x.id),silentAccumulation:false}}
  // An account is shared across organizations, so this tenant only disables it when no other tenant still needs it.
  disableAccount(input:{otherOrganizationMemberships:number;isSuperadmin:boolean}){return input.otherOrganizationMemberships===0&&!input.isSuperadmin}
  leaverOutcome(input:{grantsFailed:number;grantsStillEffective:number;recordsRemaining:number;sessionsRemaining:number;accountDisabled:boolean|null}){const failures:string[]=[];if(input.grantsFailed)failures.push("GRANT_REVOCATION_FAILED");if(input.grantsStillEffective)failures.push("ACCESS_STILL_EFFECTIVE");if(input.recordsRemaining)failures.push("EMPLOYEE_RECORD_ACTIVE");if(input.sessionsRemaining)failures.push("SESSION_STILL_ACTIVE");if(input.accountDisabled===false)failures.push("ACCOUNT_NOT_DISABLED");return{status:failures.length?"failed":"confirmed",failures,presumed:false}}
}

export type SodRule={id?:string;key:string;severity:Criticality;status:string;version?:number;mitigation_allowed?:boolean;conflicting_entitlement_refs:string[]};
export const SOD_RULE_TEMPLATES=[
  {key:"vendor_create_and_approve",name:"Criar e aprovar fornecedor crítico",description:"Quem cadastra o fornecedor não deve aprovar decisões críticas sobre ele.",rule_type:"creator_approver_conflict",conflicting_entitlement_refs:["perm:vendor:create","perm:vendor:approve_critical"],severity:"high"},
  {key:"soc_request_and_approve_response",name:"Pedir e aprovar resposta crítica",description:"Quem pede a resposta de segurança não deve aprová-la.",rule_type:"approval_execution_conflict",conflicting_entitlement_refs:["perm:soc:request_response","perm:soc:approve_critical_response"],severity:"high"},
  {key:"catalog_and_approval",name:"Definir o catálogo e aprovar acessos",description:"Quem altera o que um acesso significa não deve aprovar os pedidos desse acesso.",rule_type:"toxic_combination",conflicting_entitlement_refs:["perm:idgov:manage_catalog","perm:idgov:approve_access"],severity:"high"},
  {key:"governance_and_audit_review",name:"Administrar a governança e revisar break-glass",description:"Quem administra o módulo não deve ser o único a revisar o uso emergencial.",rule_type:"admin_audit_conflict",conflicting_entitlement_refs:["perm:idgov:manage_governance","perm:idgov:review_break_glass"],severity:"critical"},
] as const;
export class SegregationOfDutiesService{
  // A rule fires only on entitlements actually held. Job titles are never an input.
  preventive(input:{rules:SodRule[];held:string[];requested:string}){const held=new Set([...input.held,input.requested]);return input.rules.filter(r=>r.status==="active"&&r.conflicting_entitlement_refs.includes(input.requested)&&r.conflicting_entitlement_refs.every(x=>held.has(x)))}
  detective(input:{rules:SodRule[];holdings:Array<{identityId:string;keys:string[]}>}){const out:Array<{identityId:string;rule:SodRule}>=[];for(const h of input.holdings){const held=new Set(h.keys);for(const r of input.rules)if(r.status==="active"&&r.conflicting_entitlement_refs.every(x=>held.has(x)))out.push({identityId:h.identityId,rule:r})}return out}
  resolve(input:{conflicts:SodRule[];mitigations:Array<{rule_key:string;kind:string;status:string;expires_at:string}>;now?:Date}){const now=(input.now||new Date()).getTime();if(!input.conflicts.length)return{result:"no_conflict",blocking:[] as string[]};let worst="conflict_accepted";const blocking:string[]=[];for(const c of input.conflicts){const m=input.mitigations.find(x=>x.rule_key===c.key&&x.status==="active"&&Date.parse(x.expires_at)>now);if(!m){blocking.push(c.key);worst="conflict_blocked"}else if(m.kind==="mitigation"&&worst!=="conflict_blocked")worst="conflict_mitigated"}return{result:worst,blocking}}
  validateTreatment(input:{kind:"mitigation"|"acceptance";severity:string;mitigationAllowed?:boolean;owner?:string;reason?:string;control?:string;expiresAt?:string;approvers?:string[];actorId?:string;now?:Date}){const issues:string[]=[];if(input.mitigationAllowed===false)issues.push("MITIGATION_NOT_ALLOWED");if(!input.owner)issues.push("OWNER_REQUIRED");if(!input.reason)issues.push("REASON_REQUIRED");if(!input.control)issues.push("CONTROL_REQUIRED");const nowMs=(input.now||new Date()).getTime();if(!input.expiresAt||Date.parse(input.expiresAt)<=nowMs)issues.push("EXPIRY_REQUIRED");else if(Date.parse(input.expiresAt)>nowMs+365*864e5)issues.push("EXPIRY_TOO_LONG");if(input.approvers){const approvers=new Set(input.approvers);if(input.kind==="acceptance"&&input.severity==="critical"&&approvers.size<2)issues.push("CRITICAL_ACCEPTANCE_REQUIRES_ELEVATED_APPROVAL");if(input.kind==="mitigation"&&approvers.size<1)issues.push("APPROVER_REQUIRED")}return{valid:issues.length===0,issues}}
  // Approvers confirm with their own session; a treatment never takes effect from a list typed by whoever asked for it.
  requiredTreatmentApprovals(input:{kind:string;severity:string}){return input.kind==="acceptance"&&input.severity==="critical"?2:1}
  validateRule(input:{refs:string[];catalogKeys:string[]}){const known=new Set(input.catalogKeys),unknown=input.refs.filter(x=>!known.has(x)),issues:string[]=[];if(new Set(input.refs).size<2)issues.push("RULE_NEEDS_TWO_ENTITLEMENTS");if(unknown.length)issues.push("RULE_REFERENCES_UNKNOWN_ENTITLEMENT");return{valid:issues.length===0,issues,unknown}}
}

export const REVIEW_DECISIONS=["keep","revoke","reduce_scope","change_duration","delegate","needs_info"] as const;
export class AccessReviewService{
  // Whoever would review their own access is left unassigned, so it surfaces for a different reviewer instead of being certified.
  assign<T extends{identity_user_id?:string|null;owner_ref?:string|null}>(input:{items:T[];defaultReviewer?:string|null}){return input.items.map(x=>{const candidate=x.owner_ref&&/^[0-9a-f-]{36}$/i.test(x.owner_ref)?x.owner_ref:input.defaultReviewer||null;return{...x,reviewer_id:candidate&&candidate!==x.identity_user_id?candidate:null}})}
  canDecide(input:{actorId:string;identityUserId?:string|null;reviewerId?:string|null;canManage?:boolean}){const reasons:string[]=[];if(input.actorId===input.identityUserId)reasons.push("REVIEWER_CANNOT_REVIEW_OWN_ACCESS");if(input.reviewerId&&input.reviewerId!==input.actorId&&!input.canManage)reasons.push("NOT_ASSIGNED_REVIEWER");return{allowed:reasons.length===0,reasons}}
  bulk(input:{items:Array<{id:string;critical:boolean}>;decision:string;confirmed?:boolean}){if(!input.confirmed)throw new Error("BULK_CONFIRMATION_REQUIRED");if(input.decision==="keep"&&input.items.some(x=>x.critical))throw new Error("BULK_KEEP_NOT_ALLOWED_ON_CRITICAL");if(input.items.some(x=>x.critical))throw new Error("BULK_NOT_ALLOWED_ON_CRITICAL");return{ids:input.items.map(x=>x.id),audited:true}}
  certification(input:{campaignId:string;items:Array<{id:string;decision:string|null;decided_by?:string|null;decided_at?:string|null;execution_status:string}>}){if(input.items.some(x=>!x.decision||["delegate","needs_info"].includes(x.decision)))throw new Error("CAMPAIGN_HAS_PENDING_ITEMS");if(input.items.some(x=>x.execution_status==="failed"))throw new Error("CAMPAIGN_HAS_UNCONFIRMED_REVOCATIONS");return{campaign_id:input.campaignId,total:input.items.length,kept:input.items.filter(x=>x.decision==="keep").length,revoked:input.items.filter(x=>x.execution_status==="revoked").length,decisions:input.items.map(x=>({item:x.id,decision:x.decision,by:x.decided_by,at:x.decided_at,execution:x.execution_status}))}}
}

export class AccessReconciliationService{
  // Reports only. Removing anything from here would be a destructive, silent correction.
  compare(input:{effective:EffectiveEntry[];grants:Array<{id:string;user_id:string|null;entitlement_key:string;scope_key:string;status:string;valid_until?:string|null;previous_role?:string|null}>;now?:Date}){
    const now=(input.now||new Date()).getTime(),live=input.grants.filter(x=>["active","expiring"].includes(x.status)&&x.user_id),key=(u:string,k:string,s:string)=>`${u}|${k}|${s}`,effective=new Set(input.effective.map(x=>key(x.userId,x.entitlementKey,x.scopeKey))),granted=new Map(live.map(x=>[key(x.user_id as string,x.entitlement_key,x.scope_key),x]));
    // A base role replaced by a live elevation is expected to be absent until the elevation ends.
    const elevated=new Set(live.filter(x=>x.previous_role).map(x=>key(x.user_id as string,`${x.entitlement_key.split(":")[0]}:${x.previous_role}`,x.scope_key)));
    const out={matched:[] as string[],ungoverned_access:[] as EffectiveEntry[],missing_access:[] as string[],expired_but_active:[] as string[]};
    for(const e of input.effective){const g=granted.get(key(e.userId,e.entitlementKey,e.scopeKey));if(!g)out.ungoverned_access.push(e);else if(g.valid_until&&Date.parse(g.valid_until)<=now)out.expired_but_active.push(g.id);else out.matched.push(g.id)}
    for(const[k,g]of granted)if(!effective.has(k)&&!elevated.has(k))out.missing_access.push(g.id);
    return{...out,destructiveCorrection:false};
  }
}

export class AccessFindingService{
  detect(input:{now?:Date;dormantDays:number;identities:Array<{id:string;identity_type:string;owner_ref?:string|null;sponsor_ref?:string|null;user_id?:string|null;lifecycle_status:string;last_seen_at?:string|null}>;grants:Array<{id:string;identity_id:string;status:string;valid_until?:string|null;source_type:string;privileged:boolean;criticality:Criticality;scope_key:string;entitlement_id:string}>;profiles?:Array<{identity_id?:string|null;sponsor_ref?:string|null;valid_until?:string|null;status:string}>;breakGlass?:Array<{id:string;identity_id:string;status:string;review_due_at?:string|null}>}){
    const now=(input.now||new Date()).getTime(),age=(v?:string|null)=>v?(now-Date.parse(v))/864e5:Infinity,out:any[]=[],priority=new AccessPriorityService(),ids=new Map(input.identities.map(x=>[x.id,x])),add=(type:string,title:string,fp:string,refs:any,factors:any)=>{const p=priority.prioritize(factors);out.push({finding_type:type,severity:p.severity,title,fingerprint:`${type}:${fp}`,priority_reasons:p.reasons,...refs})},live=input.grants.filter(g=>["active","expiring"].includes(g.status));
    for(const i of input.identities){
      const refs={identity_id:i.id},holding=live.filter(g=>g.identity_id===i.id);
      if(NON_HUMAN_TYPES.includes(i.identity_type as never)&&!i.owner_ref&&i.lifecycle_status==="active")add("ownerless_service_account","Identidade não humana sem dono",i.id,refs,{criticality:"high",evidence:"owner_ref_vazio"});
      if(EXTERNAL_TYPES.includes(i.identity_type as never)&&!i.sponsor_ref)add("orphan_account","Identidade externa sem sponsor",i.id,refs,{criticality:"high",evidence:"sponsor_ref_vazio"});
      if(i.identity_type==="shared_account"&&i.lifecycle_status==="active")add("shared_account","Conta compartilhada ativa",i.id,refs,{criticality:"high",evidence:"tipo_compartilhada"});
      if(["terminated","archived"].includes(i.lifecycle_status)&&holding.length)add("orphan_account","Acesso ativo em identidade encerrada",i.id,refs,{criticality:"critical",evidence:`concessões_ativas:${holding.length}`});
      if(i.lifecycle_status==="active"&&holding.length&&i.last_seen_at&&age(i.last_seen_at)>input.dormantDays)add("dormant_access","Acesso sem uso no período configurado",i.id,refs,{criticality:holding.some(g=>g.privileged)?"high":"low",evidence:`sem_uso_há_${Math.floor(age(i.last_seen_at))}_dias`});
    }
    for(const g of live){if(!ids.has(g.identity_id))add("orphan_account","Concessão sem identidade ativa",`grant:${g.id}`,{grant_id:g.id,entitlement_id:g.entitlement_id},{criticality:g.criticality,evidence:"identidade_ausente"});if(g.privileged&&!g.valid_until)add("permanent_privileged_access","Acesso privilegiado sem validade",g.id,{grant_id:g.id,identity_id:g.identity_id,entitlement_id:g.entitlement_id},{criticality:g.criticality,privileged:true,scope:g.scope_key,temporary:false,evidence:g.source_type})}
    for(const p of input.profiles||[]){if(p.status==="revoked"||!p.identity_id)continue;if(!p.sponsor_ref)add("orphan_account","Acesso de terceiro sem sponsor",`vendor:${p.identity_id}`,{identity_id:p.identity_id},{criticality:"high",evidence:"sponsor_ausente"});if(p.valid_until&&Date.parse(p.valid_until)<=now&&live.some(g=>g.identity_id===p.identity_id))add("expired_vendor_access","Acesso de terceiro vencido ainda ativo",p.identity_id,{identity_id:p.identity_id},{criticality:"critical",evidence:"validade_vencida"})}
    for(const b of input.breakGlass||[])if(!["reviewed","requested"].includes(b.status)&&b.review_due_at&&Date.parse(b.review_due_at)<=now)add("unreviewed_break_glass","Break-glass com revisão atrasada",b.id,{identity_id:b.identity_id},{criticality:"high",privileged:true,evidence:"revisão_vencida"});
    return out;
  }
  validateAcceptance(input:{reason?:string;until?:string;now?:Date}){const issues:string[]=[];if(!input.reason)issues.push("REASON_REQUIRED");if(!input.until||Date.parse(input.until)<=(input.now||new Date()).getTime())issues.push("EXPIRY_REQUIRED");return{valid:issues.length===0,issues}}
  // Suggestions only: least-privilege analysis never removes anything.
  leastPrivilege(input:{grants:Array<{id:string;last_used_at?:string|null;privileged:boolean}>;unusedDays:number;now?:Date}){const now=(input.now||new Date()).getTime();return{suggestions:input.grants.filter(g=>g.last_used_at&&(now-Date.parse(g.last_used_at))/864e5>input.unusedDays).map(g=>({grant_id:g.id,suggestion:"revisar_concessão_sem_uso",automaticRemoval:false})),automaticRemoval:false}}
}

const secretField=/secret|password|token_value|raw_token|access_token|refresh_token|credential_value|private_key/i;
export class NonHumanCredentialService{
  // Inventories point to the source row. Any field that could carry a secret is dropped before storage.
  inventory<T extends Record<string,unknown>>(row:T){return Object.fromEntries(Object.entries(row).filter(([k])=>!secretField.test(k)))}
  review(input:{ownerRef?:string|null;expiresAt?:string|null;reviewDueAt?:string|null;interactiveLogin?:boolean;interactiveAllowed?:boolean;now?:Date}){const now=(input.now||new Date()).getTime(),issues:string[]=[];if(!input.ownerRef)issues.push("OWNER_REQUIRED");if(!input.expiresAt)issues.push("NO_EXPIRATION");else if(Date.parse(input.expiresAt)<=now)issues.push("EXPIRED");if(input.reviewDueAt&&Date.parse(input.reviewDueAt)<=now)issues.push("REVIEW_OVERDUE");if(input.interactiveLogin&&!input.interactiveAllowed)issues.push("INTERACTIVE_LOGIN_PROHIBITED");return{issues,secretStored:false}}
}
export class ThirdPartyAccessService{
  contractEnded(input:{relationshipStatus:string;contractEndAt?:string|null;now?:Date}){const now=(input.now||new Date()).getTime();return["exiting","terminated"].includes(input.relationshipStatus)||Boolean(input.contractEndAt&&Date.parse(input.contractEndAt)<=now)}
  validate(input:{sponsorRef?:string|null;validUntil?:string|null}){const issues:string[]=[];if(!input.sponsorRef)issues.push("SPONSOR_REQUIRED");if(!input.validUntil)issues.push("VALIDITY_REQUIRED");return{valid:issues.length===0,issues}}
}
export class SupportAccessService{
  impersonation(input:{caseRef?:string;reason?:string;minutes:number;mode?:string;approvedBy?:string|null;actorId:string;jitActive?:boolean}){const mode=input.mode==="write"?"write":"read_only",issues:string[]=[];if(!input.caseRef)issues.push("CASE_REQUIRED");if((input.reason||"").trim().length<10)issues.push("REASON_REQUIRED");if(!(input.minutes>0)||input.minutes>60)issues.push("IMPERSONATION_WINDOW_EXCEEDED");if(!input.jitActive)issues.push("JIT_REQUIRED");if(mode==="write"&&(!input.approvedBy||input.approvedBy===input.actorId))issues.push("WRITE_REQUIRES_APPROVAL");return{valid:issues.length===0,issues,mode}}
}
export class SensitiveActionService{check(input:{hasRole:boolean;requiresActivePrivilege:boolean;activePrivilege:boolean;reason?:string}){const issues:string[]=[];if(!input.hasRole)issues.push("ROLE_REQUIRED");if(input.requiresActivePrivilege&&!input.activePrivilege)issues.push("ACTIVE_PRIVILEGE_REQUIRED");if(input.requiresActivePrivilege&&!input.reason)issues.push("REASON_REQUIRED");return{allowed:issues.length===0,issues}}}
export class AccessChangeImpactService{
  // Preview only: it computes who gains, who loses and which conflicts appear, and changes nothing.
  simulate(input:{holdings:Array<{identityId:string;keys:string[]}>;add?:string[];remove?:string[];appliesTo?:string[];rules:SodRule[]}){const gain:string[]=[],lose:string[]=[],after:Array<{identityId:string;keys:string[]}>=[];for(const h of input.holdings){if(input.appliesTo&&!input.appliesTo.includes(h.identityId)){after.push(h);continue}const keys=new Set(h.keys);if((input.add||[]).some(x=>!keys.has(x)))gain.push(h.identityId);if((input.remove||[]).some(x=>keys.has(x)))lose.push(h.identityId);(input.add||[]).forEach(x=>keys.add(x));(input.remove||[]).forEach(x=>keys.delete(x));after.push({identityId:h.identityId,keys:[...keys]})}const service=new SegregationOfDutiesService(),before=new Set(service.detective({rules:input.rules,holdings:input.holdings}).map(x=>`${x.identityId}|${x.rule.key}`));return{gain,lose,newConflicts:service.detective({rules:input.rules,holdings:after}).filter(x=>!before.has(`${x.identityId}|${x.rule.key}`)).map(x=>({identityId:x.identityId,rule:x.rule.key,severity:x.rule.severity})),applied:false}}
  parseCsv(text:string,input:{catalogKeys:string[];identityRefs:string[]}){const rows=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean),header=rows.shift()?.toLowerCase().split(",").map(x=>x.trim())||[];if(header.join(",")!=="identity,entitlement,scope,action,justification")throw new Error("CSV_HEADER_INVALID");const valid:any[]=[],invalid:any[]=[];rows.forEach((row,index)=>{const[identity,entitlement,scope,action,...rest]=row.split(",").map(x=>x.trim()),justification=rest.join(",").trim(),issues:string[]=[];if(!input.identityRefs.includes(identity))issues.push("IDENTITY_UNKNOWN");if(!input.catalogKeys.includes(entitlement))issues.push("ENTITLEMENT_UNKNOWN");if(!["grant","revoke"].includes(action))issues.push("ACTION_INVALID");if(justification.length<10)issues.push("JUSTIFICATION_REQUIRED");(issues.length?invalid:valid).push({line:index+2,identity,entitlement,scope,action,justification,issues})});return{valid,invalid,previewOnly:true,directGrant:false}}
}
export class IdentityGovernanceHealthService{
  check(checks:Record<string,boolean>){const failures=Object.entries(checks).filter(([,ok])=>!ok).map(([name])=>name);return{status:failures.length?"degraded":"healthy",failures,loginBlocked:false,ordersBlocked:false,paymentsBlocked:false,authRbacRemainsActive:true,expirationsReprocessedOnRecovery:true}}
  dataQuality(input:{grants:Array<{id:string;source_type?:string|null;status:string;privileged:boolean;valid_until?:string|null;revoked_at?:string|null;revocation_confirmed_at?:string|null}>;identities:Array<{id:string;identity_type:string;owner_ref?:string|null}>;campaigns:Array<{id:string;status:string;unassigned:number}>;rules:Array<{key:string;status:string;conflicting_entitlement_refs:string[]}>;retiredKeys:string[]}){const retired=new Set(input.retiredKeys);return{grantWithoutOrigin:input.grants.filter(x=>!x.source_type).map(x=>x.id),privilegedWithoutValidity:input.grants.filter(x=>x.privileged&&!x.valid_until&&["active","expiring"].includes(x.status)).map(x=>x.id),serviceAccountWithoutOwner:input.identities.filter(x=>NON_HUMAN_TYPES.includes(x.identity_type as never)&&!x.owner_ref).map(x=>x.id),campaignWithoutReviewer:input.campaigns.filter(x=>x.status==="active"&&x.unassigned>0).map(x=>x.id),revocationNotConfirmed:input.grants.filter(x=>x.revoked_at&&!x.revocation_confirmed_at).map(x=>x.id),sodRuleOnRetiredEntitlement:input.rules.filter(x=>x.status==="active"&&x.conflicting_entitlement_refs.some(k=>retired.has(k))).map(x=>x.key)}}
}
const rate=(numerator:number,denominator:number)=>({numerator,denominator,value:denominator?numerator/denominator:null});
export class IdentityAccessMetricsService{
  // Every rate names its denominator and stays null when there is nothing to divide by.
  compute(input:{grants:Array<{status:string;privileged:boolean;valid_until?:string|null;source_type:string}>;breakGlassFinished:number;breakGlassReviewed:number;reviewItems:number;reviewItemsDecided:number;revocationsAttempted:number;revocationsConfirmed:number;openSod:number;orphans:number;ownerless:number;ungoverned:number;leaverSeconds?:number[]}){const live=input.grants.filter(x=>["active","expiring"].includes(x.status)),privileged=live.filter(x=>x.privileged),permanent=privileged.filter(x=>!x.valid_until),temporaryPrivileged=privileged.filter(x=>x.valid_until),jit=temporaryPrivileged.filter(x=>x.source_type==="jit");return{privilegedAccessCount:privileged.length,permanentPrivilegedAccessRate:rate(permanent.length,privileged.length),jitAdoptionRate:rate(jit.length,temporaryPrivileged.length),breakGlassReviewCompletionRate:rate(input.breakGlassReviewed,input.breakGlassFinished),openSodConflictCount:input.openSod,accessReviewCompletionRate:rate(input.reviewItemsDecided,input.reviewItems),revocationConfirmationRate:rate(input.revocationsConfirmed,input.revocationsAttempted),leaverRevocationTimeSeconds:input.leaverSeconds?.length?input.leaverSeconds.reduce((a,b)=>a+b,0)/input.leaverSeconds.length:null,orphanAccountCount:input.orphans,ownerlessServiceAccountCount:input.ownerless,ungovernedAccessCount:input.ungoverned}}
}
export const IDGOV_COPILOT_TOOLS=["getIdentityAccess","getEntitlement","getPrivilegedAccess","getAccessRequest","getSoDConflicts","getAccessReviewStatus","getBreakGlassHistory","getAccessFindings","explainAccessOrigin","simulateAccessChange"] as const;
// The assistant reads, explains and drafts. There is deliberately no tool that grants, revokes, approves or closes anything.
export function identityCopilot(tool:string,data:unknown){if(!IDGOV_COPILOT_TOOLS.includes(tool as never))throw new Error("IDGOV_COPILOT_TOOL_NOT_ALLOWED");return{tool,data,sections:["Identidade","Acessos","Origem/Aprovação","Validade","Conflitos","Riscos","Próximos Passos"],classifications:["fato","regra","sugestão"],canGrant:false,canRevoke:false,canApprove:false,canCloseReview:false,canActivateBreakGlass:false,canRevealSecrets:false}}
export function explainAccessOrigin(grant:{source_type:string;reason:string;approved_by?:string[];granted_at?:string|null;valid_until?:string|null;request_id?:string|null}){return{fato:{origem:grant.source_type,motivo:grant.reason,aprovadoPor:grant.approved_by||[],concedidoEm:grant.granted_at||null,validoAte:grant.valid_until||null,pedido:grant.request_id||null},regra:grant.valid_until?"Expira automaticamente na validade.":"Sem validade registrada.",sugestao:grant.source_type==="migration_baseline"?"Revisar: acesso importado na linha de base, sem aprovação registrada.":grant.valid_until?null:"Avaliar se o acesso ainda é necessário."}}
