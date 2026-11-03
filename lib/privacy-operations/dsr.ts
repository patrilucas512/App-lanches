/* eslint-disable @typescript-eslint/no-explicit-any */
/* Data subject requests on top of customer_privacy_requests (Phase 13). Identity is checked before any data leaves,
   deadlines come from settings, every step lands in the request timeline, and the answer goes out only after a person approves. */
import {createHash,createHmac,randomInt,randomUUID} from "node:crypto";
import {DSR_CHANNELS,DSR_TYPES,canDeliverSubjectData,canTransitionDsr,dsrAlert,mustData,verificationRequirement} from "./core.ts";
import {contextSalt,exportSubjectData,resolveSubject} from "./adapters.ts";
import {consentStatus,recordConsent} from "./consents.ts";
import {emitPrivacyEvent,privacyAudit,privacySettings} from "./server.ts";

const TERMINAL=["fulfilled","partially_fulfilled","rejected_with_reason","closed"],ERASURE_TYPES=["deletion","anonymization","blocking","opposition"];
export async function dsrEvent(ctx:any,request:any,input:{type:string;from?:string|null;to?:string|null;note?:string|null;evidence?:Record<string,unknown>}){
  await ctx.admin.from("privacy_dsr_events").insert({request_id:request.id,context_id:request.context_id,event_type:input.type,from_status:input.from||null,to_status:input.to||null,actor_id:ctx.actorType==="subject"?null:ctx.actorId||null,actor_type:ctx.actorType||"user",note:input.note||null,evidence:input.evidence||{}});
}
export async function loadRequest(ctx:any,id:string){
  const request=mustData(await ctx.admin.from("customer_privacy_requests").select("*").eq("id",id).eq("context_id",ctx.contextId).maybeSingle(),"solicitação");
  if(!request)throw new Error("REQUEST_NOT_FOUND");
  return request;
}

export async function createRequest(ctx:any,input:{type:string;channel:string;customerId?:string|null;organizationCustomerId?:string|null;subjectCategory?:string;subjectRef?:string|null;details?:string|null;storeId?:string|null;idempotencyKey?:string|null;portalSessionVerified?:boolean}){
  if(!(DSR_TYPES as readonly string[]).includes(input.type))throw new Error("REQUEST_TYPE_INVALID");
  if(!(DSR_CHANNELS as readonly string[]).includes(input.channel))throw new Error("CHANNEL_INVALID");
  const category=input.subjectCategory||"end_customer";
  let subject:any=null;
  if(category==="end_customer"){subject=await resolveSubject(ctx.admin,{contextId:ctx.contextId,organizationId:ctx.organizationId,customerId:input.customerId,organizationCustomerId:input.organizationCustomerId});if(!subject)throw new Error("SUBJECT_NOT_FOUND")}
  else if(!String(input.subjectRef||"").trim())throw new Error("SUBJECT_REQUIRED");
  const requirement=verificationRequirement({type:input.type,channel:input.channel,portalSessionVerified:input.portalSessionVerified});
  const row={organization_id:ctx.organizationId,context_id:ctx.contextId,establishment_id:input.storeId||null,customer_id:subject?.customerIds[0]||null,organization_customer_id:subject?.organizationCustomerId||null,subject_category:category,subject_ref:subject?.subjectRef||String(input.subjectRef).slice(0,120),request_type:input.type,channel:input.channel,details:input.details?String(input.details).slice(0,1000):null,
    verification_method:requirement.method,verification_status:requirement.required?"pending":input.portalSessionVerified?"verified":"not_required",verified_at:!requirement.required&&input.portalSessionVerified?new Date().toISOString():null,idempotency_key:input.idempotencyKey||null};
  const{data,error}=await ctx.admin.from("customer_privacy_requests").insert(row).select().single();
  if(error?.code==="23505"&&input.idempotencyKey){const{data:existing}=await ctx.admin.from("customer_privacy_requests").select("*").eq("context_id",ctx.contextId).eq("idempotency_key",input.idempotencyKey).single();return{request:existing,duplicate:true}}
  if(error)throw new Error(`solicitação: ${error.message}`);
  await dsrEvent(ctx,data,{type:"received",to:"received",evidence:{channel:input.channel,verification:requirement.method}});
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorType==="subject"?null:ctx.actorId,actorType:ctx.actorType||"user",action:"dsr_received",resourceType:"data_subject_request",resourceId:data.id,metadata:{type:input.type,channel:input.channel}});
  await emitPrivacyEvent(ctx.admin,{organizationId:ctx.organizationId,storeId:input.storeId,event:"privacy.dsr_received",aggregateType:"data_subject_request",aggregateId:data.id,payload:{type:input.type,due_at:data.due_at}}).catch(()=>{});
  return{request:data,duplicate:false};
}

export async function transitionRequest(ctx:any,input:{id:string;to:string;note?:string|null;reason?:string|null;outcome?:Record<string,unknown>}){
  const request=await loadRequest(ctx,input.id);
  if(!canTransitionDsr(request.status,input.to))throw new Error("STATUS_INVALID");
  if(input.to==="rejected_with_reason"&&String(input.reason||"").trim().length<10)throw new Error("REASON_REQUIRED");
  if(["fulfilled","partially_fulfilled"].includes(input.to)&&["access","portability","correction","deletion","anonymization"].includes(request.request_type)&&!canDeliverSubjectData(request))throw new Error("VERIFICATION_REQUIRED");
  if(input.to==="partially_fulfilled"&&!input.reason&&!input.outcome&&!request.rejection_reason)throw new Error("REASON_REQUIRED");
  // A deletion-type request is fulfilled only by a completed plan, never by a click: a pending domain keeps it partial.
  if(input.to==="fulfilled"&&ERASURE_TYPES.includes(request.request_type)){const{data:done}=await ctx.admin.from("privacy_deletion_plans").select("id").eq("request_id",request.id).eq("context_id",ctx.contextId).eq("status","completed").limit(1);if(!(done||[]).length)throw new Error("DELETION_PLAN_NOT_COMPLETED")}
  const patch:any={status:input.to,updated_at:new Date().toISOString()};
  if(input.reason)patch.rejection_reason=String(input.reason).slice(0,1000);
  if(input.outcome)patch.outcome={...request.outcome,...input.outcome};
  if(TERMINAL.includes(input.to)&&!request.completed_at)patch.completed_at=new Date().toISOString();
  const saved=mustData(await ctx.admin.from("customer_privacy_requests").update(patch).eq("id",request.id).eq("status",request.status).select().single(),"solicitação");
  await dsrEvent(ctx,request,{type:"status_changed",from:request.status,to:input.to,note:input.note||input.reason||null});
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:"dsr_status_changed",resourceType:"data_subject_request",resourceId:request.id,reason:input.reason||null,metadata:{from:request.status,to:input.to}});
  return saved;
}

/* Identity check. A six-digit code goes to the phone already on file (never to a contact the requester types in);
   only an HMAC with the context salt is stored. Without a channel to send it, a person verifies by hand. */
const codeHash=(salt:string,requestId:string,code:string)=>createHmac("sha256",salt).update(`dsr:${requestId}:${code}`).digest("hex");
export async function startVerification(ctx:any,input:{id:string}){
  const request=await loadRequest(ctx,input.id);
  if(request.verification_status==="verified")return{status:"verified"};
  const{data:customer}=request.customer_id?await ctx.admin.from("customers").select("phone,establishment_id").eq("id",request.customer_id).maybeSingle():{data:null};
  const digits=String(customer?.phone||"").replace(/\D/g,"");
  if(digits.length<10||!ctx.sendCode)return{status:"manual_review_required",reason:digits.length<10?"NO_REGISTERED_CONTACT":"NO_CHANNEL"};
  const code=String(randomInt(0,1e6)).padStart(6,"0"),salt=await contextSalt(ctx.admin,ctx.contextId);
  const sent=await ctx.sendCode({storeId:customer.establishment_id,to:digits,text:`Seu código para confirmar o pedido sobre seus dados é ${code}. Ele expira em 15 minutos. Se não foi você, ignore esta mensagem.`}).catch(()=>false);
  if(!sent)return{status:"manual_review_required",reason:"SEND_FAILED"};
  await ctx.admin.from("privacy_dsr_verifications").insert({request_id:request.id,context_id:ctx.contextId,method:"otp_registered_contact",code_hash:codeHash(salt,request.id,code),destination_masked:`••••${digits.slice(-4)}`,expires_at:new Date(Date.now()+15*6e4).toISOString()});
  if(request.status==="received")await transitionRequest(ctx,{id:request.id,to:"verifying",note:"Código enviado ao contato cadastrado."});
  return{status:"code_sent",destination:`••••${digits.slice(-4)}`};
}
export async function confirmVerification(ctx:any,input:{id:string;code:string}){
  const request=await loadRequest(ctx,input.id);
  const{data:check}=await ctx.admin.from("privacy_dsr_verifications").select("*").eq("request_id",request.id).eq("method","otp_registered_contact").is("verified_at",null).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(!check||Date.parse(check.expires_at)<Date.now())throw new Error("CODE_EXPIRED");
  if(check.attempts>=check.max_attempts)throw new Error("TOO_MANY_ATTEMPTS");
  const salt=await contextSalt(ctx.admin,ctx.contextId),ok=codeHash(salt,request.id,String(input.code||"").trim())===check.code_hash;
  await ctx.admin.from("privacy_dsr_verifications").update(ok?{verified_at:new Date().toISOString(),attempts:check.attempts+1}:{attempts:check.attempts+1}).eq("id",check.id);
  if(!ok){await dsrEvent(ctx,request,{type:"verification_failed"});throw new Error("CODE_INVALID")}
  await ctx.admin.from("customer_privacy_requests").update({verification_status:"verified",verified_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",request.id);
  await dsrEvent(ctx,request,{type:"verified",evidence:{method:"otp_registered_contact",destination:check.destination_masked}});
  return{status:"verified"};
}
// When no code can be sent, the DPO or someone allowed to approve requests records how identity was confirmed.
export async function verifyManually(ctx:any,input:{id:string;notes:string}){
  if(String(input.notes||"").trim().length<10)throw new Error("REASON_REQUIRED");
  const request=await loadRequest(ctx,input.id);
  await ctx.admin.from("privacy_dsr_verifications").insert({request_id:request.id,context_id:ctx.contextId,method:"manual_review",verified_at:new Date().toISOString(),decided_by:ctx.actorId,notes:String(input.notes).slice(0,500)});
  await ctx.admin.from("customer_privacy_requests").update({verification_status:"verified",verified_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",request.id);
  await dsrEvent(ctx,request,{type:"verified",note:"Verificação manual",evidence:{method:"manual_review"}});
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:"dsr_verified_manually",resourceType:"data_subject_request",resourceId:request.id});
  return{status:"verified"};
}

// Access and portability: one JSON package, in a private bucket, behind a link that expires. The audit keeps its hash, not its content.
export async function generateAccessPackage(ctx:any,input:{id:string}){
  const request=await loadRequest(ctx,input.id);
  if(!["access","portability","confirmation"].includes(request.request_type))throw new Error("REQUEST_TYPE_INVALID");
  if(!canDeliverSubjectData(request))throw new Error("VERIFICATION_REQUIRED");
  const subject=await resolveSubject(ctx.admin,{contextId:ctx.contextId,organizationId:ctx.organizationId,customerId:request.customer_id,organizationCustomerId:request.organization_customer_id});
  if(!subject)throw new Error("SUBJECT_NOT_FOUND");
  const settings=await privacySettings(ctx.admin,ctx.contextId);
  const payload={...await exportSubjectData(ctx.admin,subject),consents:await consentStatus(ctx.admin,ctx.contextId,subject.subjectRef),request:{id:request.id,type:request.request_type,received_at:request.received_at}};
  const body=JSON.stringify(payload,null,2),sha256=createHash("sha256").update(body).digest("hex"),path=`${ctx.contextId}/${request.id}/${randomUUID()}.json`;
  const{error}=await ctx.admin.storage.from("privacy-exports").upload(path,new Blob([body],{type:"application/json"}),{contentType:"application/json",upsert:false});
  if(error)throw new Error(`pacote: ${error.message}`);
  const expiresAt=new Date(Date.now()+settings.export_link_hours*36e5).toISOString();
  const pack=mustData(await ctx.admin.from("privacy_export_packages").insert({request_id:request.id,context_id:ctx.contextId,storage_path:path,sha256,size_bytes:Buffer.byteLength(body),domains:Object.keys(payload.domains),missing_domains:payload.missingDomains,expires_at:expiresAt,created_by:ctx.actorType==="subject"?null:ctx.actorId}).select().single(),"pacote");
  await dsrEvent(ctx,request,{type:"package_generated",evidence:{package_id:pack.id,sha256,domains:pack.domains,missing:pack.missing_domains}});
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorType==="subject"?null:ctx.actorId,actorType:ctx.actorType||"user",action:"access_package_generated",resourceType:"privacy_export_package",resourceId:pack.id,metadata:{request_id:request.id,sha256,domains:pack.domains}});
  return{package:{id:pack.id,expires_at:expiresAt,domains:pack.domains,missing_domains:pack.missing_domains}};
}
export async function packageLink(ctx:any,input:{packageId:string;requestId?:string}){
  let query=ctx.admin.from("privacy_export_packages").select("*").eq("id",input.packageId).eq("context_id",ctx.contextId);
  if(input.requestId)query=query.eq("request_id",input.requestId);
  const pack=mustData(await query.maybeSingle(),"pacote");
  if(!pack)throw new Error("PACKAGE_NOT_FOUND");
  const left=Math.floor((Date.parse(pack.expires_at)-Date.now())/1000);if(left<=0)throw new Error("PACKAGE_EXPIRED");
  const{data,error}=await ctx.admin.storage.from("privacy-exports").createSignedUrl(pack.storage_path,Math.min(left,3600),{download:`meus-dados-${pack.id.slice(0,8)}.json`});
  if(error)throw new Error(error.message);
  await ctx.admin.from("privacy_export_packages").update({downloaded_at:new Date().toISOString()}).eq("id",pack.id);
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorType==="subject"?null:ctx.actorId,actorType:ctx.actorType||"user",action:"access_package_downloaded",resourceType:"privacy_export_package",resourceId:pack.id});
  return{url:data.signedUrl,expires_at:pack.expires_at};
}

// Correction goes to the customer record the rest of the product reads (Customer 360 / Master Data). Phone changes keep the portal's own code flow.
export async function applyCorrection(ctx:any,input:{id:string;name?:string|null;email?:string|null}){
  const request=await loadRequest(ctx,input.id);
  if(request.request_type!=="correction")throw new Error("REQUEST_TYPE_INVALID");
  if(!canDeliverSubjectData(request))throw new Error("VERIFICATION_REQUIRED");
  const subject=await resolveSubject(ctx.admin,{contextId:ctx.contextId,organizationId:ctx.organizationId,customerId:request.customer_id,organizationCustomerId:request.organization_customer_id});
  if(!subject)throw new Error("SUBJECT_NOT_FOUND");
  const patch:any={};if(input.name!=null){const name=String(input.name).trim();if(name.length<2||name.length>120)throw new Error("NAME_INVALID");patch.name=name}
  if(input.email!=null){const email=String(input.email).trim().toLowerCase();if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error("EMAIL_INVALID");patch.email=email||null}
  if(!Object.keys(patch).length)throw new Error("NOTHING_TO_CORRECT");
  if(subject.customerIds.length)mustData(await ctx.admin.from("customers").update(patch).in("id",subject.customerIds).select("id"),"correção");
  if(subject.organizationCustomerId)mustData(await ctx.admin.from("organization_customers").update({...patch,updated_at:new Date().toISOString()}).eq("id",subject.organizationCustomerId).select("id"),"correção");
  await dsrEvent(ctx,request,{type:"corrected",evidence:{fields:Object.keys(patch)}});
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:"dsr_correction_applied",resourceType:"data_subject_request",resourceId:request.id,metadata:{fields:Object.keys(patch)}});
  return{fields:Object.keys(patch)};
}

// Revocation applies to new sends at once, through the same path the legacy senders read.
export async function revokeAllMarketing(ctx:any,input:{id:string}){
  const request=await loadRequest(ctx,input.id);
  const{data:purposes}=await ctx.admin.from("consent_purposes").select("purpose_key,channels").eq("context_id",ctx.contextId).eq("active",true);
  const revoked:string[]=[];
  for(const purpose of purposes||[])for(const channel of purpose.channels||["any"]){await recordConsent(ctx,{customerId:request.customer_id,subjectRef:request.subject_ref,storeId:request.establishment_id,purposeKey:purpose.purpose_key,channel,status:"revoked",origin:"data_subject_request",sourceRef:request.id});revoked.push(`${purpose.purpose_key}:${channel}`)}
  await dsrEvent(ctx,request,{type:"consents_revoked",evidence:{purposes:revoked}});
  return{revoked};
}

// The reply to the subject. A draft (from a person or from AI) is never sent until someone allowed to approve signs it off.
export async function saveResponseDraft(ctx:any,input:{id:string;text:string;byAi?:boolean}){
  const request=await loadRequest(ctx,input.id),text=String(input.text||"").trim();
  if(text.length<10)throw new Error("RESPONSE_REQUIRED");
  await ctx.admin.from("customer_privacy_requests").update({response_draft:text.slice(0,4000),response_draft_by_ai:input.byAi===true,response_approved_by:null,updated_at:new Date().toISOString()}).eq("id",request.id);
  await dsrEvent(ctx,request,{type:"response_drafted",evidence:{by_ai:input.byAi===true}});
  return{ok:true};
}
export async function approveResponse(ctx:any,input:{id:string}){
  if(ctx.actorType&&ctx.actorType!=="user")throw new Error("HUMAN_DECISION_REQUIRED");
  const request=await loadRequest(ctx,input.id);
  if(!request.response_draft)throw new Error("RESPONSE_REQUIRED");
  const now=new Date().toISOString();
  await ctx.admin.from("customer_privacy_requests").update({response_approved_by:ctx.actorId,response_sent_at:now,updated_at:now}).eq("id",request.id);
  await dsrEvent(ctx,request,{type:"response_sent",evidence:{by_ai:request.response_draft_by_ai,approved_by:ctx.actorId}});
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:"dsr_response_approved",resourceType:"data_subject_request",resourceId:request.id,metadata:{ai_draft:request.response_draft_by_ai}});
  return{sent_at:now};
}

// Deadline scan for the worker and the overview: records the alert level and tells the assignee once per level.
export async function scanDeadlines(ctx:any,now=new Date()){
  const settings=await privacySettings(ctx.admin,ctx.contextId);
  const{data}=await ctx.admin.from("customer_privacy_requests").select("id,status,due_at,last_alert_level,assignee_id,request_type,establishment_id").eq("context_id",ctx.contextId).not("status","in",`(${TERMINAL.join(",")})`).limit(2000);
  let alerted=0;
  for(const request of data||[]){const level=dsrAlert({dueAt:request.due_at,status:request.status,now,alertDaysBefore:settings.dsr_alert_days_before});
    if(level===request.last_alert_level||!["due_soon","overdue"].includes(level))continue;
    await ctx.admin.from("customer_privacy_requests").update({last_alert_level:level}).eq("id",request.id);
    if(ctx.notify&&request.assignee_id&&request.establishment_id)await ctx.notify(ctx.admin,{organizationId:ctx.organizationId,storeId:request.establishment_id,eventType:`privacy.dsr_${level}`,sourceType:"data_subject_request",sourceId:request.id,recipientUserId:request.assignee_id,priority:level==="overdue"?"critical":"high",requiresAction:true,title:level==="overdue"?"Solicitação de titular vencida":"Solicitação de titular perto do prazo",summary:"Abra Privacidade & LGPD para ver a solicitação.",route:`/painel/seguranca/privacidade?id=${request.id}`}).catch(()=>{});
    alerted++}
  return{alerted};
}
