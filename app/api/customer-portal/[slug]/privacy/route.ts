/* eslint-disable @typescript-eslint/no-explicit-any */
import{NextResponse}from"next/server";import{createAdminClient,withAdminCredentials}from"@/lib/supabase/admin";import{getPortalContext}from"@/lib/customer-portal";
import{DSR_TYPES}from"@/lib/privacy-operations/core";import{PrivacyUnavailable,isNotInstalled,tenantContext}from"@/lib/privacy-operations/server";import{consentStatus,ensurePurposes,recordConsent}from"@/lib/privacy-operations/consents";import{createRequest,generateAccessPackage,packageLink,transitionRequest}from"@/lib/privacy-operations/dsr";
// The subject's own privacy center. The portal session was opened with a code on the subject's phone, which is the identity
// check; everything here is read and written for that one customer, inside that store's organization.
const reply=(body:any,status=200)=>NextResponse.json(body,{status,headers:{"cache-control":"private, no-store","x-content-type-options":"nosniff"}});
const SUBJECT_TYPES=["confirmation","access","correction","deletion","anonymization","portability","sharing_info","consent_revocation","automated_decision_review","opposition"];
async function subjectContext(slug:string){
 const portal:any=await getPortalContext(slug);if(!portal?.customer?.id)throw new Error("AUTH");
 const admin=createAdminClient(),{data:store}=await admin.from("establishments").select("id,organization_id,name").eq("slug",slug).eq("active",true).maybeSingle();if(!store?.organization_id)throw new Error("FORBIDDEN");
 const{data:flags,error}=await admin.from("store_feature_flags").select("privacy_operations_enabled,privacy_dsr_portal_enabled").eq("establishment_id",store.id).maybeSingle();
 if(isNotInstalled(error))throw new PrivacyUnavailable();
 if(!flags?.privacy_operations_enabled||!flags?.privacy_dsr_portal_enabled)throw new Error("FEATURE_DISABLED");
 const context=await tenantContext(admin,store.organization_id),{data:customer}=await admin.from("customers").select("id,organization_customer_id").eq("id",portal.customer.id).single();if(!customer)throw new Error("AUTH");
 return{admin,organizationId:store.organization_id,storeId:store.id,contextId:context.id,actorId:null,actorType:"subject",customerId:customer.id,subjectRef:String(customer.organization_customer_id||customer.id),permissions:[],flags};
}
const fail=(error:any)=>{if(error instanceof PrivacyUnavailable||isNotInstalled(error))return reply({error:"PRIVACY_NOT_INSTALLED"},503);const m=String(error?.message||"Falha.");return reply({error:m},m==="AUTH"?401:m==="FEATURE_DISABLED"||m==="FORBIDDEN"?403:/^[A-Z_,:]+$/.test(m)?422:500)};

export const GET=withAdminCredentials(async(_req:Request,{params}:{params:Promise<{slug:string}>})=>{try{const{slug}=await params,ctx=await subjectContext(slug);await ensurePurposes(ctx.admin,ctx.contextId);
 const[{data:purposes},consents,{data:requests}]=await Promise.all([ctx.admin.from("consent_purposes").select("id,purpose_key,label,channels,current_version,requires_reacceptance,consent_text_versions(version,body)").eq("context_id",ctx.contextId).eq("active",true).order("purpose_key"),consentStatus(ctx.admin,ctx.contextId,ctx.subjectRef),ctx.admin.from("customer_privacy_requests").select("id,request_type,status,received_at,due_at,completed_at,rejection_reason,response_draft,response_sent_at,privacy_export_packages(id,expires_at)").eq("context_id",ctx.contextId).eq("subject_ref",ctx.subjectRef).order("received_at",{ascending:false}).limit(50)]);
 return reply({purposes:(purposes||[]).map((p:any)=>({...p,text:(p.consent_text_versions||[]).find((v:any)=>v.version===p.current_version)?.body||null,consent_text_versions:undefined})),consents,requests:(requests||[]).map((r:any)=>({...r,response:r.response_sent_at?r.response_draft:null,response_draft:undefined,packages:(r.privacy_export_packages||[]).filter((p:any)=>Date.parse(p.expires_at)>Date.now()),privacy_export_packages:undefined}))});
}catch(error){return fail(error)}});

export const POST=withAdminCredentials(async(req:Request,{params}:{params:Promise<{slug:string}>})=>{try{const{slug}=await params,ctx=await subjectContext(slug),body=await req.json();
 if(body.action==="set_consent"){const purpose=String(body.purpose_key||""),channel=String(body.channel||"any");return reply(await recordConsent(ctx,{customerId:ctx.customerId,subjectRef:ctx.subjectRef,storeId:ctx.storeId,purposeKey:purpose,channel,status:body.granted===true?"granted":"revoked",origin:"customer_portal",evidence:{screen:"portal_privacy_center"}}))}
 if(body.action==="create_request"){const type=String(body.type||"");if(!SUBJECT_TYPES.includes(type)||!(DSR_TYPES as readonly string[]).includes(type))throw new Error("REQUEST_TYPE_INVALID");return reply(await createRequest(ctx,{type,channel:"customer_portal",customerId:ctx.customerId,details:String(body.details||"").slice(0,1000),storeId:ctx.storeId,idempotencyKey:body.client_request_id?`portal:${String(body.client_request_id).slice(0,64)}`:null,portalSessionVerified:true}))}
 // "Baixar meus dados": an access request answered on the spot, because the portal session already proved who this is.
 if(body.action==="download_my_data"){const created:any=await createRequest(ctx,{type:"access",channel:"customer_portal",customerId:ctx.customerId,storeId:ctx.storeId,idempotencyKey:body.client_request_id?`portal:${String(body.client_request_id).slice(0,64)}`:null,portalSessionVerified:true});
  const request=created.request,pack=await generateAccessPackage(ctx,{id:request.id});
  if(request.status==="received"){await transitionRequest(ctx,{id:request.id,to:"in_progress",note:"Pacote gerado pelo portal."});await transitionRequest(ctx,{id:request.id,to:"fulfilled",outcome:{package_id:pack.package.id,missing_domains:pack.package.missing_domains}})}
  return reply({...pack,link:await packageLink(ctx,{packageId:pack.package.id,requestId:request.id})})}
 if(body.action==="package_link"){const{data:own}=await ctx.admin.from("privacy_export_packages").select("id,request_id,customer_privacy_requests!inner(subject_ref)").eq("id",String(body.package_id||"")).eq("context_id",ctx.contextId).eq("customer_privacy_requests.subject_ref",ctx.subjectRef).maybeSingle();if(!own)throw new Error("FORBIDDEN");return reply(await packageLink(ctx,{packageId:own.id,requestId:own.request_id}))}
 throw new Error("ACTION_INVALID");
}catch(error){return fail(error)}});
