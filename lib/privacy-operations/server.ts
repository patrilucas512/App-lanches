/* eslint-disable @typescript-eslint/no-explicit-any */
/* What every privacy service needs: audit, settings, flags, events and the check that the module is installed at all. */

// Starting points only. Every value is configurable per context and the screen marks them as pending the DPO's review.
export const PRIVACY_SETTINGS_DEFAULTS={
  dsr_deadline_days:{default:15} as Record<string,number|null>,
  dsr_alert_days_before:3,
  require_lia_for_legitimate_interest:true,
  dpia_triggers:["sensitive_data","driver_location_monitoring","ai_with_personal_data","marketing_profiling","new_sharing_integration"] as string[],
  incident_notification_deadline_days:null as number|null,
  hold_review_days:180,
  export_link_hours:24,
  require_current_consent_version:false,
  retention_requires_approval:true,
  self_approval_allowed:false,
  legal_review_status:"pending" as "pending"|"reviewed",
};

// The migration may not be applied where this code runs (merge publishes to production before the database catches up).
// A missing table or column is "not installed", which the API answers with 503 instead of breaking anything else.
export const isNotInstalled=(error:any)=>Boolean(error)&&(["42P01","42703","PGRST204","PGRST205","PGRST200"].includes(String(error.code))||/does not exist|schema cache|Could not find/i.test(String(error.message||"")));
export class PrivacyUnavailable extends Error{constructor(){super("PRIVACY_NOT_INSTALLED")}}

export async function privacyAudit(admin:any,input:{organizationId?:string|null;contextId:string;actorId?:string|null;actorType?:string;action:string;resourceType:string;resourceId?:string|null;reason?:string|null;metadata?:Record<string,unknown>}){
  // The audit says that something happened and why. It never carries the personal data itself.
  const metadata=input.metadata||{};
  await Promise.all([
    admin.from("privacy_audit_events").insert({context_id:input.contextId,organization_id:input.organizationId||null,actor_id:input.actorId||null,actor_type:input.actorType||(input.actorId?"user":"system"),action:input.action,resource_type:input.resourceType,resource_id:input.resourceId||null,reason:input.reason||null,metadata}),
    admin.from("security_audit_logs").insert({actor_user_id:input.actorId||null,organization_id:input.organizationId||null,action:`privacy.${input.action}`,target_type:input.resourceType,target_id:input.resourceId||null,metadata}),
  ]);
}

export async function privacySettings(admin:any,contextId:string){
  const{data}=await admin.from("privacy_settings").select("*").eq("context_id",contextId).maybeSingle();
  const merged:any={...PRIVACY_SETTINGS_DEFAULTS,...(data||{})};
  merged.dsr_deadline_days={...PRIVACY_SETTINGS_DEFAULTS.dsr_deadline_days,...(data?.dsr_deadline_days||{})};
  return merged as typeof PRIVACY_SETTINGS_DEFAULTS;
}

export async function privacyStoreFlags(admin:any,storeId:string,flags:readonly string[]){
  const[{data:row,error},{data:subscription}]=await Promise.all([admin.from("store_feature_flags").select(flags.join(",")).eq("establishment_id",storeId).maybeSingle(),admin.from("subscriptions").select(`plans(${flags.join(",")})`).eq("establishment_id",storeId).in("status",["active","trialing","past_due"]).order("created_at",{ascending:false}).limit(1).maybeSingle()]);
  if(isNotInstalled(error))throw new PrivacyUnavailable();
  const plan=(subscription as any)?.plans;
  return Object.fromEntries(flags.map(flag=>[flag,(row as any)?.[flag]===true||plan?.[flag]===true])) as Record<string,boolean>;
}

// One tenant context per organization, created on first use. The platform context exists once, from the migration.
export async function tenantContext(admin:any,organizationId:string,name?:string){
  const{data,error}=await admin.from("privacy_contexts").select("*").eq("organization_id",organizationId).eq("kind","tenant_controller").maybeSingle();
  if(isNotInstalled(error))throw new PrivacyUnavailable();
  if(data)return data;
  const{data:created,error:insertError}=await admin.from("privacy_contexts").upsert({organization_id:organizationId,kind:"tenant_controller",name:name||"Controlador (estabelecimento)"},{onConflict:"organization_id,kind",ignoreDuplicates:false}).select().single();
  if(insertError)throw new Error(`contexto de privacidade: ${insertError.message}`);
  return created;
}

export async function emitPrivacyEvent(admin:any,input:{organizationId:string;storeId?:string|null;event:string;aggregateType:string;aggregateId:string;dedupe?:string;payload?:Record<string,unknown>}){
  const id=`${input.event}:${input.aggregateId}${input.dedupe?`:${input.dedupe}`:""}`;
  const{error}=await admin.from("automation_event_inbox").upsert({id,organization_id:input.organizationId,store_id:input.storeId||null,event_name:input.event,schema_version:1,aggregate_type:input.aggregateType,aggregate_id:input.aggregateId,payload:input.payload||{},correlation_id:id},{onConflict:"id",ignoreDuplicates:true});
  if(error)throw new Error(`evento ${input.event}: ${error.message}`);
}
