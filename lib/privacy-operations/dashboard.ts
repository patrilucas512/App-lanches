/* eslint-disable @typescript-eslint/no-explicit-any */
/* What the screen shows. Everything is read inside the viewer's own context; no subject data is listed here. */
import {dsrAlert,privacyMetrics} from "./core.ts";
import {ensurePurposes} from "./consents.ts";
import {ensureLegalBases} from "./ropa.ts";
import {dataMap} from "./inventory.ts";
import {dataLocations,subprocessors} from "./governance.ts";
import {holdsDueForReview,RETENTION_DATASETS} from "./retention.ts";
import {IMPLEMENTED_DOMAINS,PENDING_ADAPTERS} from "./adapters.ts";
import {PRIVACY_SETTINGS_DEFAULTS,privacySettings} from "./server.ts";
import {goLiveChecklist} from "./golive.ts";

export async function privacyDashboard(ctx:any){
  await Promise.all([ensureLegalBases(ctx.admin,ctx.contextId),ensurePurposes(ctx.admin,ctx.contextId)]);
  const ctxId=ctx.contextId,org=(table:string,columns="*")=>ctx.admin.from(table).select(columns).eq("context_id",ctxId);
  const[settings,map,{data:findings},{data:activities},{data:bases},{data:purposes},{data:requests},{data:consents},{data:policies},{data:runs},{data:holds},{data:incidents},{data:dpias},{data:reviews},{data:aiUses},{data:plans},locations,processors,reviewHolds,{data:changes},{data:agents}]=await Promise.all([
    privacySettings(ctx.admin,ctxId),dataMap(ctx),
    org("privacy_inventory_findings").eq("status","open").limit(500),
    org("processing_activities").order("updated_at",{ascending:false}).limit(500),
    org("privacy_legal_bases").order("basis_key"),
    org("consent_purposes").order("purpose_key"),
    org("customer_privacy_requests","id,request_type,channel,status,subject_category,verification_status,received_at,due_at,completed_at,assignee_id,rejection_reason,affected_domains,response_draft,response_draft_by_ai,response_sent_at,created_at").order("received_at",{ascending:false}).limit(500),
    org("consent_current","purpose_key,channel,status").limit(20000),
    org("retention_policies").order("created_at",{ascending:false}),
    org("retention_runs").order("created_at",{ascending:false}).limit(50),
    org("legal_holds").order("created_at",{ascending:false}).limit(200),
    org("privacy_incident_assessments","*,operational_incidents(incident_number,title,severity,status)").order("created_at",{ascending:false}).limit(100),
    org("privacy_impact_assessments").order("updated_at",{ascending:false}).limit(200),
    org("privacy_design_reviews").order("created_at",{ascending:false}).limit(100),
    org("ai_personal_data_uses").limit(200),
    org("privacy_deletion_plans").order("created_at",{ascending:false}).limit(50),
    dataLocations(ctx),subprocessors(ctx),holdsDueForReview(ctx),
    ctx.admin.from("change_requests").select("id,title,status").eq("organization_id",ctx.organizationId).not("status","in","(closed,cancelled,rejected)").order("created_at",{ascending:false}).limit(50),
    ctx.admin.from("ai_agents").select("id,name,agent_key").eq("organization_id",ctx.organizationId).limit(100),
  ]);
  const now=new Date(),alertDays=settings.dsr_alert_days_before,list=requests||[];
  const withAlert=list.map((r:any)=>({...r,alert:dsrAlert({dueAt:r.due_at,status:r.status,now,alertDaysBefore:alertDays})}));
  const open=withAlert.filter((r:any)=>!["fulfilled","partially_fulfilled","rejected_with_reason","closed"].includes(r.status));
  const latestRun=new Map<string,any>();for(const r of runs||[])if(r.mode==="dry_run"&&!latestRun.has(r.policy_id))latestRun.set(r.policy_id,r);
  const overdueRetention=[...latestRun.values()].reduce((n,r:any)=>n+Number(r.due_count||0),0);
  const openIncidents=(incidents||[]).filter((x:any)=>x.status!=="closed").length;
  const consentRows=consents||[];
  return{
    context:{id:ctxId,kind:ctx.contextKind,name:ctx.contextName},
    cards:{openRequests:open.length,requestsDueSoon:open.filter((r:any)=>["due_soon","overdue"].includes(r.alert)).length,activeConsents:consentRows.filter((c:any)=>c.status==="granted").length,revokedConsents:consentRows.filter((c:any)=>c.status==="revoked").length,overdueRetention,unmappedFields:(findings||[]).length,openIncidents,pendingDpias:(dpias||[]).filter((d:any)=>["draft","in_review","needs_update"].includes(d.status)).length,subprocessorsWithoutReview:processors.filter((p:any)=>p.reviewOverdue).length,holdsToReview:reviewHolds.length},
    metrics:privacyMetrics({requests:list,consents:consentRows,unmappedFields:(findings||[]).length,overdueRetention,openIncidents,now}),
    map,findings:findings||[],activities:activities||[],legalBases:bases||[],purposes:purposes||[],
    consentSummary:Object.values(consentRows.reduce((acc:any,c:any)=>{const k=`${c.purpose_key}|${c.channel}`;acc[k]||={purpose:c.purpose_key,channel:c.channel,granted:0,revoked:0,expired:0};acc[k][c.status]=(acc[k][c.status]||0)+1;return acc},{})),
    requests:withAlert,plans:plans||[],
    retention:{policies:policies||[],runs:runs||[],datasets:RETENTION_DATASETS},holds:holds||[],holdsToReview:reviewHolds.map((h:any)=>h.id),
    locations,subprocessors:processors,incidents:incidents||[],dpias:dpias||[],designReviews:reviews||[],aiUses:aiUses||[],changes:changes||[],agents:agents||[],
    adapters:{implemented:IMPLEMENTED_DOMAINS,pending:PENDING_ADAPTERS},
    goLive:ctx.organizationId&&ctx.storeId?await goLiveChecklist(ctx):[],
    settings:{...PRIVACY_SETTINGS_DEFAULTS,...settings},permissions:ctx.permissions,flags:ctx.flags,
    notices:{legal:"Esta área é ferramenta de operação, não aconselhamento jurídico. Textos, prazos e bases legais precisam da validação do encarregado (DPO) ou do jurídico.",backups:"Dados excluídos continuam em backups até a expiração natural deles (Fase 25)."},
  };
}

// For the worker: contexts whose store has the module on.
export async function contextsWithPrivacy(admin:any){
  // Only stores that went live through the checklist; a plan flag alone never starts the worker for a store.
  const{data:stores,error}=await admin.from("store_feature_flags").select("establishments(organization_id)").eq("privacy_operations_enabled",true).limit(5000);
  if(error)throw error;
  const orgs=[...new Set((stores||[]).map((x:any)=>x.establishments?.organization_id).filter(Boolean))] as string[];
  if(!orgs.length)return[];
  const{data}=await admin.from("privacy_contexts").select("id,organization_id").in("organization_id",orgs).eq("kind","tenant_controller");
  return data||[];
}
