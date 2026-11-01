/* eslint-disable @typescript-eslint/no-explicit-any */
/* Canonical identity events for the SOC. They go into the existing security_events store, and a failure here never blocks the access flow. */
import {SecurityEventIngestionService} from "../security-operations/core.ts";

const EVENT_TYPE={grant:"access_change",elevation:"privilege",jit:"privilege",break_glass:"privilege",revocation:"access_change",revocation_failed:"security_control",vendor_terminated:"vendor_access",service_account:"service_account",leaver:"access_change"} as const;
export const IDENTITY_SOC_EVENT_KINDS=Object.keys(EVENT_TYPE) as Array<keyof typeof EVENT_TYPE>;

export async function emitIdentityEvent(admin:any,input:{organizationId:string;kind:keyof typeof EVENT_TYPE;sourceEventId:string;actorRef?:string|null;targetType:string;targetRef:string;severity?:"info"|"warning"|"high"|"critical";title:string;metadata?:Record<string,unknown>}){
  try{
    const eventTime=new Date().toISOString(),event=new SecurityEventIngestionService().normalize({organizationId:input.organizationId,context:"tenant_soc",eventType:EVENT_TYPE[input.kind],sourceDomain:"identity",sourceRef:input.kind,sourceEventId:input.sourceEventId,actorIdentityRef:input.actorRef||undefined,targetEntityType:input.targetType,targetEntityRef:input.targetRef,eventTime,quality:"authoritative",metadataRef:input.metadata});
    const{error}=await admin.from("security_events").insert({organization_id:input.organizationId,event_type:event.eventType,severity:input.severity||"info",title:input.title,description:input.title,source:"identity_governance",metadata:event.metadataRef,soc_context:"tenant_soc",source_domain:"identity",source_ref:input.kind,source_event_id:input.sourceEventId,actor_identity_ref:input.actorRef||null,target_entity_type:input.targetType,target_entity_ref:input.targetRef,severity_hint:input.severity||"info",event_time:eventTime,event_quality:"authoritative",dedup_key:event.dedupKey});
    if(error&&error.code!=="23505")return{emitted:false,error:error.message};
    return{emitted:!error,deduplicated:Boolean(error)};
  }catch(error:any){return{emitted:false,error:error.message}}
}

// What the SOC reads to enrich an alert. Only counts and references: changing access stays in Phase 93.
export async function identityContextForSoc(admin:any,organizationId:string,identityRef?:string){
  const[identities,grants,breakGlass,failed,findings,credentials]=await Promise.all([
    admin.from("governed_identities").select("id,identity_type,identity_ref,lifecycle_status,governance_status").eq("organization_id",organizationId).limit(500),
    admin.from("access_grants").select("id,identity_id,status,source_type,valid_until,access_entitlements(key,privileged,criticality)").eq("organization_id",organizationId).in("status",["active","expiring"]).limit(1000),
    admin.from("break_glass_events").select("id,identity_id,status,expires_at,review_due_at").eq("organization_id",organizationId).neq("status","reviewed").limit(100),
    admin.from("access_grants").select("id,identity_id,failure_reason,updated_at").eq("organization_id",organizationId).eq("status","failed").limit(100),
    admin.from("access_findings").select("id,finding_type,severity,identity_id").eq("organization_id",organizationId).eq("state","open").in("finding_type",["expired_vendor_access","ownerless_service_account","orphan_account","unreviewed_break_glass"]).limit(200),
    admin.from("non_human_credentials").select("id,credential_kind,owner_ref,expires_at,status").eq("organization_id",organizationId).limit(200),
  ]);
  const rows=identities.data||[],ids=identityRef?new Set(rows.filter((x:any)=>x.identity_ref===identityRef||x.id===identityRef).map((x:any)=>x.id)):null,keep=(x:any)=>!ids||ids.has(x.identity_id),live=(grants.data||[]).filter(keep),privileged=live.filter((x:any)=>x.access_entitlements?.privileged);
  return{canonicalSource:"identity_governance",available:!identities.error,identity:identityRef?rows.filter((x:any)=>ids?.has(x.id)):undefined,activePrivilegedGrants:privileged.length,permanentPrivilegedGrants:privileged.filter((x:any)=>!x.valid_until).length,openBreakGlass:(breakGlass.data||[]).filter(keep),revocationFailures:(failed.data||[]).filter(keep),terminatedWithActiveAccess:rows.filter((i:any)=>["terminated","archived"].includes(i.lifecycle_status)&&live.some((g:any)=>g.identity_id===i.id)).map((i:any)=>i.id),findings:(findings.data||[]).filter((x:any)=>!ids||!x.identity_id||ids.has(x.identity_id)),ownerlessCredentials:(credentials.data||[]).filter((x:any)=>!x.owner_ref&&x.status==="active").length};
}
