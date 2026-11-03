/* eslint-disable @typescript-eslint/no-explicit-any */
import{NextResponse}from"next/server";import{createClient}from"@/lib/supabase/server";import{createAdminClient}from"@/lib/supabase/admin";import{publishNotification}from"@/lib/notifications/publisher";import{sendWhatsAppText}from"@/lib/whatsapp/cloud-api";
import{PRIVACY_FLAGS,PrivacyAccessService}from"@/lib/privacy-operations/core";import{PRIVACY_SETTINGS_DEFAULTS,PrivacyUnavailable,isNotInstalled,privacyAudit,privacySettings,tenantContext}from"@/lib/privacy-operations/server";import{privacyDashboard}from"@/lib/privacy-operations/dashboard";
import{resolveFinding,saveMapEntry,syncWithDataGovernance}from"@/lib/privacy-operations/inventory";import{exportRopa,saveActivity}from"@/lib/privacy-operations/ropa";import{consentStatus,publishConsentText,recordConsent}from"@/lib/privacy-operations/consents";
import{applyCorrection,approveResponse,confirmVerification,createRequest,generateAccessPackage,loadRequest,packageLink,revokeAllMarketing,saveResponseDraft,startVerification,transitionRequest,verifyManually}from"@/lib/privacy-operations/dsr";
import{confirmManualStep,decidePlan,executePlan,previewDeletion,requestPlanApproval}from"@/lib/privacy-operations/deletion";import{createHold,decideRetentionRun,releaseHold,requestRetentionRun,reviewHold,runRetention,savePolicy}from"@/lib/privacy-operations/retention";
import{assessIncident,decideDesignReview,decideIncidentNotification,dpoOpinion,exportSubprocessors,incidentDrafts,markIncidentNotified,openDesignReview,openPrivacyIncident,saveAiUse,saveDataLocation,saveDpia,saveSubprocessor}from"@/lib/privacy-operations/governance";import{privacyCopilot}from"@/lib/privacy-operations/integrations";import{disableStore,dpoValidationPack,enableStore,goLiveChecklist}from"@/lib/privacy-operations/golive";import{activePrivacyPolicies,previewDeadlineImpact,privacyPolicyTemplates}from"@/lib/privacy-operations/policies";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,STATUS:Record<string,number>={AUTH:401,FORBIDDEN:403,FEATURE_DISABLED:403,REQUEST_NOT_FOUND:404,SUBJECT_NOT_FOUND:404,PACKAGE_NOT_FOUND:404,PRIVACY_NOT_INSTALLED:503},response=(body:any,status=200)=>NextResponse.json(body,{status,headers:{"cache-control":"private, no-store","x-content-type-options":"nosniff"}});
const id=(value:unknown)=>{if(!value||!UUID.test(String(value)))throw new Error("INVALID_ID");return String(value)};
// A database without the Phase 95 migration answers 503 in JSON; nothing else in the app depends on this route.
const fail=(error:any)=>{if(error instanceof PrivacyUnavailable||isNotInstalled(error))return response({error:"PRIVACY_NOT_INSTALLED"},503);const message=String(error?.message||"Falha em Privacidade & LGPD."),code=message.split(":")[0].split(",")[0];return response({error:message},STATUS[code]||(/^[A-Z_,:]+$/.test(message)?422:500))};
async function context(storeId:string,wantPlatform=false){
 if(!UUID.test(storeId))throw new Error("FORBIDDEN");
 const client=await createClient(),{data}=await client.auth.getClaims(),userId=String(data?.claims?.sub||"");if(!userId)throw new Error("AUTH");
 const admin=createAdminClient(),{data:store}=await admin.from("establishments").select("id,organization_id,name").eq("id",storeId).maybeSingle();if(!store)throw new Error("FORBIDDEN");
 const flagsList=PRIVACY_FLAGS.join(","),[{data:local},{data:org},{data:custom,error:customError},{data:flagRow,error:flagError},{data:subscription},{data:profile}]=await Promise.all([admin.from("establishment_members").select("role").eq("establishment_id",storeId).eq("user_id",userId).eq("status","active").maybeSingle(),admin.from("organization_members").select("role,all_stores").eq("organization_id",store.organization_id).eq("user_id",userId).eq("active",true).maybeSingle(),admin.from("privacy_member_permissions").select("permission_key").eq("organization_id",store.organization_id).eq("user_id",userId).eq("active",true),admin.from("store_feature_flags").select(flagsList).eq("establishment_id",storeId).maybeSingle(),admin.from("subscriptions").select(`plans(${flagsList})`).eq("establishment_id",storeId).in("status",["active","trialing","past_due"]).order("created_at",{ascending:false}).limit(1).maybeSingle(),admin.from("profiles").select("is_superadmin").eq("id",userId).maybeSingle()]);
 if(isNotInstalled(customError)||isNotInstalled(flagError))throw new PrivacyUnavailable();
 if(!local&&!org)throw new Error("FORBIDDEN");
 const plan:any=(subscription as any)?.plans,flags=Object.fromEntries(PRIVACY_FLAGS.map(f=>[f,(flagRow as any)?.[f]===true||plan?.[f]===true])) as Record<string,boolean>;
 // What reaches customers is the store's own flag, switched on only through the go-live checklist. A plan flag only
 // opens the configuration screens, like privacy_setup_enabled.
 flags.privacy_operations_enabled=(flagRow as any)?.privacy_operations_enabled===true;
 flags.privacy_setup_enabled=flags.privacy_setup_enabled||plan?.privacy_operations_enabled===true;
 if(!flags.privacy_operations_enabled&&!flags.privacy_setup_enabled)throw new Error("FEATURE_DISABLED");
 const superadmin=profile?.is_superadmin===true,permissions=new PrivacyAccessService().resolve({orgRole:org?.role,storeRole:local?.role,explicit:(custom||[]).map((x:any)=>x.permission_key)});
 // The platform context (MasterApp as controller of its SaaS customers) is only for MasterApp's own superadmins.
 let ctxRow:any;
 if(wantPlatform){if(!superadmin)throw new Error("FORBIDDEN");const{data:p}=await admin.from("privacy_contexts").select("*").eq("kind","platform_controller").single();ctxRow=p}
 else ctxRow=await tenantContext(admin,store.organization_id);
 const notify=(a:any,input:any)=>publishNotification(a,input);
 const sendCode=async(input:{storeId:string;to:string;text:string})=>{const{data:connection}=await admin.from("whatsapp_connections").select("id,phone_number_id,graph_api_version").eq("establishment_id",input.storeId).eq("status","connected").order("is_primary",{ascending:false}).limit(1).maybeSingle();if(!connection)return false;const{data:credential}=await admin.rpc("get_whatsapp_connection_secret",{requested_connection_id:connection.id});if(!credential?.access_token)return false;await sendWhatsAppText({phoneNumberId:connection.phone_number_id,accessToken:credential.access_token,graphApiVersion:connection.graph_api_version,to:input.to,text:input.text});return true};
 return{admin,organizationId:ctxRow.kind==="platform_controller"?null:store.organization_id,storeId,storeName:store.name,contextId:ctxRow.id,contextKind:ctxRow.kind,contextName:ctxRow.name,actorId:userId,actorType:"user",superadmin,permissions:wantPlatform?[...new Set([...permissions,"privacy:view"])]:permissions,flags,notify,sendCode};
}
const need=(ctx:any,...keys:string[])=>{for(const k of keys)if(!ctx.permissions.includes(k))throw new Error("FORBIDDEN")};
const tenantOnly=(ctx:any)=>{if(!ctx.organizationId)throw new Error("TENANT_CONTEXT_REQUIRED")};
export async function GET(req:Request){try{const params=new URL(req.url).searchParams,ctx=await context(String(params.get("store_id")||""),params.get("context")==="platform");need(ctx,"privacy:view");
 const view=params.get("view");
 if(view==="request"){need(ctx,"privacy:handle_dsr");const request=await loadRequest(ctx,id(params.get("id")));const[{data:events},{data:packages},{data:plans}]=await Promise.all([ctx.admin.from("privacy_dsr_events").select("event_type,from_status,to_status,actor_type,note,evidence,created_at").eq("request_id",request.id).order("created_at"),ctx.admin.from("privacy_export_packages").select("id,expires_at,domains,missing_domains,downloaded_at,created_at").eq("request_id",request.id).order("created_at",{ascending:false}),ctx.admin.from("privacy_deletion_plans").select("id,status,mode,summary,created_at").eq("request_id",request.id).order("created_at",{ascending:false})]);return response({request,events:events||[],packages:packages||[],plans:plans||[]})}
 if(view==="plan"){need(ctx,"privacy:handle_dsr");const{data:steps}=await ctx.admin.from("privacy_deletion_steps").select("id,domain,table_name,decision,reason,status,error_code").eq("plan_id",id(params.get("id"))).eq("context_id",ctx.contextId).limit(2000);return response({steps:steps||[]})}
 return response(await privacyDashboard(ctx))
}catch(error:any){return fail(error)}}
async function run(ctx:any,action:string,body:any):Promise<any>{switch(action){
 case"save_map_entry":need(ctx,"privacy:manage_inventory");return saveMapEntry(ctx,body.entry||{});
 case"sync_data_governance":need(ctx,"privacy:manage_inventory");tenantOnly(ctx);return syncWithDataGovernance(ctx);
 case"dismiss_finding":need(ctx,"privacy:manage_inventory");return resolveFinding(ctx,{id:id(body.id),reason:String(body.reason||"")});
 case"save_activity":need(ctx,"privacy:manage_ropa");return saveActivity(ctx,body.activity||{});
 case"export_ropa":return exportRopa(ctx);
 case"update_legal_basis":{need(ctx,"privacy:manage_ropa");const patch:any={updated_at:new Date().toISOString()};if(body.label)patch.label=String(body.label).slice(0,120);if(body.description!=null)patch.description=String(body.description).slice(0,1000);if(typeof body.active==="boolean")patch.active=body.active;const{data,error}=await ctx.admin.from("privacy_legal_bases").update(patch).eq("id",id(body.id)).eq("context_id",ctx.contextId).select().single();if(error)throw new Error(error.message);await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:"legal_basis_updated",resourceType:"privacy_legal_basis",resourceId:data.id});return data}
 case"publish_consent_text":need(ctx,"privacy:manage_consents");return publishConsentText(ctx,{purposeKey:String(body.purpose_key||""),body:String(body.body||""),material:body.material===true});
 case"record_consent":need(ctx,"privacy:manage_consents");tenantOnly(ctx);return recordConsent(ctx,{customerId:id(body.customer_id),subjectRef:String(body.subject_ref||body.customer_id),storeId:ctx.storeId,purposeKey:String(body.purpose_key||""),channel:String(body.channel||"any"),status:body.status==="granted"?"granted":"revoked",origin:"establishment_manual",evidence:{note:String(body.note||"").slice(0,300)}});
 case"consent_status":{need(ctx,"privacy:view_subject_data");const request=await loadRequest(ctx,id(body.request_id));await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:"subject_data_viewed",resourceType:"data_subject_request",resourceId:request.id,metadata:{view:"consents"}});return{consents:await consentStatus(ctx.admin,ctx.contextId,request.subject_ref)}}
 case"create_request":{need(ctx,"privacy:handle_dsr");const category=String(body.subject_category||"end_customer");if(category!=="lead")tenantOnly(ctx);
  return createRequest(ctx,{type:String(body.type||""),channel:String(body.channel||"manual"),customerId:body.customer_id?id(body.customer_id):null,staffMemberId:body.staff_member_id?id(body.staff_member_id):null,leadId:body.lead_id?id(body.lead_id):null,subjectCategory:category,subjectRef:body.subject_ref,details:body.details,storeId:ctx.organizationId?ctx.storeId:null,idempotencyKey:body.idempotency_key||null})}
 case"assign":{need(ctx,"privacy:handle_dsr");const request=await loadRequest(ctx,id(body.id));await ctx.admin.from("customer_privacy_requests").update({assignee_id:body.assignee_id?id(body.assignee_id):ctx.actorId,updated_at:new Date().toISOString()}).eq("id",request.id);return{ok:true}}
 case"transition":need(ctx,"privacy:handle_dsr");if(["fulfilled","partially_fulfilled","rejected_with_reason"].includes(body.to))need(ctx,"privacy:approve_dsr");return transitionRequest(ctx,{id:id(body.id),to:String(body.to||""),note:body.note,reason:body.reason});
 case"start_verification":need(ctx,"privacy:handle_dsr");return startVerification(ctx,{id:id(body.id)});
 case"confirm_verification":need(ctx,"privacy:handle_dsr");return confirmVerification(ctx,{id:id(body.id),code:String(body.code||"")});
 case"verify_manually":need(ctx,"privacy:approve_dsr");return verifyManually(ctx,{id:id(body.id),notes:String(body.notes||"")});
 case"generate_package":need(ctx,"privacy:handle_dsr","privacy:view_subject_data");return generateAccessPackage(ctx,{id:id(body.id)});
 case"package_link":need(ctx,"privacy:view_subject_data");return packageLink(ctx,{packageId:id(body.package_id)});
 case"apply_correction":need(ctx,"privacy:handle_dsr");return applyCorrection(ctx,{id:id(body.id),name:body.name??null,email:body.email??null});
 case"revoke_consents":need(ctx,"privacy:handle_dsr");return revokeAllMarketing(ctx,{id:id(body.id)});
 case"save_response_draft":need(ctx,"privacy:handle_dsr");if(body.by_ai===true&&!ctx.flags.privacy_ai_assistance_enabled)throw new Error("FEATURE_DISABLED");return saveResponseDraft(ctx,{id:id(body.id),text:String(body.text||""),byAi:body.by_ai===true});
 case"approve_response":need(ctx,"privacy:approve_dsr");return approveResponse(ctx,{id:id(body.id)});
 case"preview_deletion":need(ctx,"privacy:handle_dsr");return previewDeletion(ctx,{requestId:id(body.request_id)});
 case"request_plan_approval":need(ctx,"privacy:handle_dsr");return requestPlanApproval(ctx,{planId:id(body.plan_id)});
 case"decide_plan":need(ctx,"privacy:approve_dsr");return decidePlan(ctx,{planId:id(body.plan_id),decision:body.decision==="approved"?"approved":"rejected",reason:String(body.reason||"")});
 case"execute_plan":need(ctx,"privacy:execute_deletion");return executePlan(ctx,{planId:id(body.plan_id)});
 case"confirm_manual_step":need(ctx,"privacy:execute_deletion");return confirmManualStep(ctx,{stepId:id(body.step_id),note:String(body.note||"")});
 case"save_policy":need(ctx,"privacy:manage_retention");return savePolicy(ctx,body.policy||{});
 case"simulate_retention":need(ctx,"privacy:manage_retention");tenantOnly(ctx);return runRetention(ctx,{policyId:id(body.policy_id),mode:"dry_run"});
 case"request_retention_run":need(ctx,"privacy:manage_retention");return requestRetentionRun(ctx,{policyId:id(body.policy_id)});
 case"decide_retention_run":need(ctx,"privacy:approve_retention_run");return decideRetentionRun(ctx,{runId:id(body.run_id),decision:body.decision==="approved"?"approved":"rejected",reason:String(body.reason||"")});
 case"execute_retention_run":{need(ctx,"privacy:approve_retention_run","privacy:execute_deletion");tenantOnly(ctx);const{data:runRow}=await ctx.admin.from("retention_runs").select("policy_id").eq("id",id(body.run_id)).eq("context_id",ctx.contextId).single();return runRetention(ctx,{policyId:runRow.policy_id,mode:"execute",runId:id(body.run_id)})}
 case"create_hold":need(ctx,"privacy:manage_legal_holds");return createHold(ctx,body.hold||{});
 case"release_hold":need(ctx,"privacy:manage_legal_holds");return releaseHold(ctx,{id:id(body.id),reason:String(body.reason||"")});
 case"review_hold":need(ctx,"privacy:manage_legal_holds");return reviewHold(ctx,{id:id(body.id),note:body.note});
 case"save_location":need(ctx,"privacy:manage_governance");return saveDataLocation(ctx,body.location||{});
 case"save_subprocessor":need(ctx,"privacy:manage_governance");tenantOnly(ctx);return saveSubprocessor(ctx,body.subprocessor||{});
 case"export_subprocessors":tenantOnly(ctx);return exportSubprocessors(ctx);
 case"open_incident":need(ctx,"privacy:manage_incidents");tenantOnly(ctx);return openPrivacyIncident(ctx,{title:String(body.title||""),summary:String(body.summary||""),severity:body.severity,source:body.incident_id?"incident":"manual",incidentId:body.incident_id?id(body.incident_id):null,storeId:ctx.storeId});
 case"assess_incident":need(ctx,"privacy:manage_incidents");return assessIncident(ctx,{...body.assessment,id:id(body.id)});
 case"decide_incident":need(ctx,"privacy:manage_incidents");return decideIncidentNotification(ctx,{id:id(body.id),anpd:body.anpd,subjects:body.subjects,reason:String(body.reason||"")});
 case"incident_drafts":{need(ctx,"privacy:manage_incidents");const{data:assessment,error}=await ctx.admin.from("privacy_incident_assessments").select("*").eq("id",id(body.id)).eq("context_id",ctx.contextId).single();if(error)throw new Error(error.message);return incidentDrafts(assessment,{name:ctx.storeName})}
 case"mark_notified":need(ctx,"privacy:manage_incidents");return markIncidentNotified(ctx,{id:id(body.id),target:body.target==="anpd"?"anpd":"subjects",evidence:String(body.evidence||"")});
 case"save_dpia":need(ctx,"privacy:manage_dpia");return saveDpia(ctx,body.dpia||{});
 case"dpo_opinion":need(ctx,"privacy:dpo");return dpoOpinion(ctx,{id:id(body.id),opinion:String(body.opinion||""),decision:["approved","rejected","in_review"].includes(body.decision)?body.decision:"in_review"});
 case"open_design_review":need(ctx,"privacy:manage_dpia");return openDesignReview(ctx,{changeRequestId:body.change_request_id?id(body.change_request_id):null,title:String(body.title||""),signals:body.signals||{}});
 case"decide_design_review":need(ctx,"privacy:manage_dpia");return decideDesignReview(ctx,{id:id(body.id),status:body.status,reason:String(body.reason||"")});
 case"save_ai_use":need(ctx,"privacy:manage_governance");return saveAiUse(ctx,body.use||{});
 case"update_settings":{need(ctx,"privacy:manage_governance");const patch:any={};for(const key of Object.keys(PRIVACY_SETTINGS_DEFAULTS))if(body.settings&&key in body.settings)patch[key]=body.settings[key];
  // Marking the texts and deadlines as reviewed is the DPO's statement, so only the DPO can make it.
  if("legal_review_status" in patch&&!ctx.permissions.includes("privacy:dpo"))throw new Error("FORBIDDEN");
  const before=await privacySettings(ctx.admin,ctx.contextId),{data,error}=await ctx.admin.from("privacy_settings").upsert({context_id:ctx.contextId,...patch,updated_by:ctx.actorId,updated_at:new Date().toISOString()},{onConflict:"context_id"}).select().single();if(error)throw new Error(error.message);await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:"settings_updated",resourceType:"privacy_settings",resourceId:ctx.contextId,metadata:{before,after:patch}});return{settings:data}}
 case"copilot":{if(!ctx.flags.privacy_ai_assistance_enabled)throw new Error("FEATURE_DISABLED");const data=await privacyDashboard(ctx);let extra:any={};
  if(body.request_id){need(ctx,"privacy:handle_dsr");const request=await loadRequest(ctx,id(body.request_id));extra={request};if(body.tool==="getConsentStatus"){need(ctx,"privacy:view_subject_data");extra.consents=await consentStatus(ctx.admin,ctx.contextId,request.subject_ref)}}
  return privacyCopilot(String(body.tool),data,{...extra,id:body.id})}
 case"go_live_checklist":need(ctx,"privacy:view");tenantOnly(ctx);return{items:await goLiveChecklist(ctx)};
 case"enable_store":need(ctx,"privacy:manage_governance");tenantOnly(ctx);return enableStore(ctx,{override:body.override===true,reason:body.reason||null});
 case"disable_store":need(ctx,"privacy:manage_governance");tenantOnly(ctx);return disableStore(ctx,{reason:String(body.reason||"")});
 case"policy_overview":{need(ctx,"privacy:view");const[{policies,available},settings]=await Promise.all([activePrivacyPolicies(ctx.admin,ctx.organizationId),privacySettings(ctx.admin,ctx.contextId)]);return{available,active:policies.map((p:any)=>({key:p.key,version:p.version,id:p.id})),templates:privacyPolicyTemplates(settings as any),howToPublish:"Os modelos são publicados pela governança da Fase 79 (Políticas), com versão, testes, aprovação e auditoria."}}
 case"dpo_validation_pack":need(ctx,"privacy:view");tenantOnly(ctx);return dpoValidationPack(ctx);
 case"policy_impact":need(ctx,"privacy:manage_governance");return previewDeadlineImpact(ctx,body.policy);
 default:throw new Error("ACTION_INVALID");
}}
export async function POST(req:Request){try{const body=await req.json(),ctx=await context(String(body.store_id||""),body.context==="platform");need(ctx,"privacy:view");return response(await run(ctx,String(body.action||""),body))}catch(error:any){return fail(error)}}
