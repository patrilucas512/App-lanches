/* eslint-disable @typescript-eslint/no-explicit-any */
/* Canonical consent. Writes go through privacy_record_consent, which also updates the legacy columns; reads come from the
   canonical records. Other modules call marketingConsentGate before a marketing send. */
import {consentDecision,mustData} from "./core.ts";
import {isNotInstalled,privacyAudit} from "./server.ts";

// Starting purposes. Texts are placeholders until the tenant's DPO writes and reviews them.
export const DEFAULT_PURPOSES=[
  {purpose_key:"marketing_whatsapp",label:"Ofertas e novidades por WhatsApp",kind:"marketing",channels:["whatsapp"]},
  {purpose_key:"marketing_email",label:"Ofertas e novidades por e-mail",kind:"marketing",channels:["email"]},
  {purpose_key:"satisfaction_survey",label:"Pesquisas de satisfação",kind:"survey",channels:["whatsapp","email"]},
  {purpose_key:"ai_personalization",label:"Uso dos meus pedidos para recomendações com IA",kind:"ai",channels:["any"]},
] as const;
const PLACEHOLDER="Texto a ser redigido e revisado pelo encarregado (DPO) do estabelecimento.";

export async function ensurePurposes(admin:any,contextId:string){
  const{data:existing}=await admin.from("consent_purposes").select("purpose_key").eq("context_id",contextId);
  const have=new Set((existing||[]).map((x:any)=>x.purpose_key));
  for(const purpose of DEFAULT_PURPOSES.filter(x=>!have.has(x.purpose_key))){
    const{data:created}=await admin.from("consent_purposes").upsert({context_id:contextId,...purpose,channels:[...purpose.channels]},{onConflict:"context_id,purpose_key",ignoreDuplicates:true}).select("id").maybeSingle();
    if(created)await admin.from("consent_text_versions").insert({purpose_id:created.id,context_id:contextId,version:1,body:PLACEHOLDER});
  }
}

// A new text version. A material change can require everyone to accept again, which the gate then enforces.
export async function publishConsentText(ctx:any,input:{purposeKey:string;body:string;material:boolean}){
  const body=String(input.body||"").trim();if(body.length<20)throw new Error("CONSENT_TEXT_REQUIRED");
  const purpose=mustData(await ctx.admin.from("consent_purposes").select("*").eq("context_id",ctx.contextId).eq("purpose_key",input.purposeKey).single(),"finalidade");
  const version=purpose.current_version+1;
  mustData(await ctx.admin.from("consent_text_versions").insert({purpose_id:purpose.id,context_id:ctx.contextId,version,body,material:input.material,created_by:ctx.actorId}).select().single(),"texto");
  await ctx.admin.from("consent_purposes").update({current_version:version,requires_reacceptance:input.material||purpose.requires_reacceptance,updated_at:new Date().toISOString()}).eq("id",purpose.id);
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:"consent_text_published",resourceType:"consent_purpose",resourceId:purpose.id,metadata:{purpose:input.purposeKey,version,material:input.material}});
  return{version};
}

export async function recordConsent(ctx:any,input:{customerId?:string|null;subjectRef:string;storeId?:string|null;purposeKey:string;channel:string;status:"granted"|"revoked";origin:string;sourceRef?:string|null;evidence?:Record<string,unknown>;textVersion?:number|null}){
  if(!["granted","revoked"].includes(input.status))throw new Error("CONSENT_STATUS_INVALID");
  const{data:purpose}=await ctx.admin.from("consent_purposes").select("current_version,active").eq("context_id",ctx.contextId).eq("purpose_key",input.purposeKey).maybeSingle();
  if(!purpose?.active)throw new Error("PURPOSE_NOT_FOUND");
  const{data:id,error}=await ctx.admin.rpc("privacy_record_consent",{requested_context_id:ctx.contextId,requested_establishment_id:input.storeId||null,requested_customer_id:input.customerId||null,requested_subject_ref:input.subjectRef,requested_purpose:input.purposeKey,requested_channel:input.channel,requested_status:input.status,requested_text_version:input.status==="granted"?(input.textVersion??purpose.current_version):null,requested_origin:input.origin,requested_source_ref:input.sourceRef||null,requested_evidence:input.evidence||{},requested_actor:ctx.actorType==="subject"?null:ctx.actorId||null});
  if(error)throw new Error(error.message.includes("SUBJECT_NOT_IN_CONTEXT")?"SUBJECT_NOT_IN_CONTEXT":`consentimento: ${error.message}`);
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorType==="subject"?null:ctx.actorId,actorType:ctx.actorType||"user",action:input.status==="granted"?"consent_granted":"consent_revoked",resourceType:"consent_record",resourceId:String(id),metadata:{purpose:input.purposeKey,channel:input.channel,origin:input.origin}});
  return{id};
}

// Current state per purpose and channel for one subject.
export async function consentStatus(admin:any,contextId:string,subjectRef:string){
  const{data,error}=await admin.from("consent_current").select("purpose_key,channel,status,text_version,recorded_at,origin,expires_at").eq("context_id",contextId).eq("subject_ref",subjectRef).limit(100);
  if(error)throw new Error(error.message);
  return data||[];
}

/* The gate other modules call before a marketing send.
   - module not installed or not enabled for the store: "legacy", and the caller keeps its own checks exactly as before;
   - enabled: the canonical registry decides, and any failure to read it blocks marketing (fail-safe);
   - transactional messages about an order always pass. */
export async function marketingConsentGate(admin:any,input:{storeId:string;customerId:string;purposeKey:string;channel:string;kind?:"marketing"|"transactional";now?:Date}){
  if(input.kind==="transactional")return{mode:"canonical" as const,allowed:true,reason:"TRANSACTIONAL"};
  const{data:flags,error:flagError}=await admin.from("store_feature_flags").select("privacy_operations_enabled").eq("establishment_id",input.storeId).maybeSingle();
  if(flagError&&isNotInstalled(flagError))return{mode:"legacy" as const,allowed:null,reason:"NOT_INSTALLED"};
  if(flagError)return{mode:"canonical" as const,allowed:false,reason:"REGISTRY_UNAVAILABLE"};
  if(flags?.privacy_operations_enabled!==true)return{mode:"legacy" as const,allowed:null,reason:"NOT_ENABLED"};
  try{
    const{data:customer,error}=await admin.from("customers").select("id,organization_customer_id,establishments(organization_id)").eq("id",input.customerId).maybeSingle();
    if(error||!customer)return{mode:"canonical" as const,allowed:false,reason:error?"REGISTRY_UNAVAILABLE":"NO_CONSENT"};
    const{data:context,error:contextError}=await admin.from("privacy_contexts").select("id").eq("organization_id",(customer as any).establishments?.organization_id).eq("kind","tenant_controller").maybeSingle();
    if(contextError)return{mode:"canonical" as const,allowed:false,reason:"REGISTRY_UNAVAILABLE"};
    if(!context)return{mode:"canonical" as const,allowed:false,reason:"NO_CONSENT"};
    const subjectRef=String(customer.organization_customer_id||customer.id);
    const[{data:records,error:recordError},{data:purpose}]=await Promise.all([
      admin.from("consent_records").select("purpose_key,channel,status,text_version,recorded_at,created_at,expires_at,seq").eq("context_id",context.id).eq("subject_ref",subjectRef).eq("purpose_key",input.purposeKey).order("recorded_at",{ascending:false}).limit(20),
      admin.from("consent_purposes").select("current_version,requires_reacceptance").eq("context_id",context.id).eq("purpose_key",input.purposeKey).maybeSingle(),
    ]);
    const decision=consentDecision({kind:"marketing",purpose:input.purposeKey,channel:input.channel,records:recordError?null:records,registryAvailable:!recordError,now:input.now||new Date(),currentTextVersion:purpose?{[input.purposeKey]:purpose.current_version}:undefined,requireCurrentVersion:purpose?.requires_reacceptance===true});
    return{mode:"canonical" as const,...decision};
  }catch{return{mode:"canonical" as const,allowed:false,reason:"REGISTRY_UNAVAILABLE"}}
}

// For callers that already ran their legacy checks: true when the canonical registry also allows it, or is not in charge.
export async function canonicalAllows(admin:any,input:{storeId?:string|null;customerId:string;purposeKey:string;channel:string}){
  if(!input.storeId)return true;
  const gate=await marketingConsentGate(admin,{storeId:input.storeId,customerId:input.customerId,purposeKey:input.purposeKey,channel:input.channel});
  return gate.mode==="legacy"||gate.allowed===true;
}

// Batch form for audience previews. null means the module is not in charge for this store and legacy rules apply alone.
export async function canonicalAllowedSet(admin:any,input:{storeId:string;customerIds:string[];purposeKey:string;channel:string;now?:Date}):Promise<Set<string>|null>{
  const{data:flags,error:flagError}=await admin.from("store_feature_flags").select("privacy_operations_enabled").eq("establishment_id",input.storeId).maybeSingle();
  if(flagError&&isNotInstalled(flagError))return null;
  if(flagError)return new Set();
  if(flags?.privacy_operations_enabled!==true)return null;
  const{data:store}=await admin.from("establishments").select("organization_id").eq("id",input.storeId).maybeSingle();
  const{data:context}=store?await admin.from("privacy_contexts").select("id").eq("organization_id",store.organization_id).eq("kind","tenant_controller").maybeSingle():{data:null};
  if(!context)return new Set();
  const allowed=new Set<string>();
  for(let i=0;i<input.customerIds.length;i+=500){
    const ids=input.customerIds.slice(i,i+500),{data:customers,error}=await admin.from("customers").select("id,organization_customer_id").in("id",ids);
    if(error)return new Set();
    const refOf=new Map((customers||[]).map((c:any)=>[String(c.organization_customer_id||c.id),c.id]));
    const{data:records,error:recordError}=await admin.from("consent_current").select("subject_ref,purpose_key,channel,status,text_version,recorded_at,expires_at").eq("context_id",context.id).eq("purpose_key",input.purposeKey).in("subject_ref",[...refOf.keys()]);
    if(recordError)return new Set();
    for(const[ref,customerId]of refOf){const decision=consentDecision({kind:"marketing",purpose:input.purposeKey,channel:input.channel,records:(records||[]).filter((r:any)=>r.subject_ref===ref),registryAvailable:true,now:input.now||new Date()});if(decision.allowed)allowed.add(String(customerId))}
  }
  return allowed;
}
