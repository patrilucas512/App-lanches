/* eslint-disable @typescript-eslint/no-explicit-any */
/* External reviews enter only through an official adapter. No scraping path exists: a provider without an adapter is recorded as not supported. */
export const EXTERNAL_PROVIDERS:Record<string,{name:string;feedbackSource:"google_import"|"marketplace_import";note:string}>={
  google_business_profile:{name:"Google Business Profile",feedbackSource:"google_import",note:"Precisa de adaptador oficial e de credencial aprovada pelo Google."},
  ifood:{name:"iFood",feedbackSource:"marketplace_import",note:"Depende de um adaptador da Fase 69 com a capacidade reviews_read."},
  rappi:{name:"Rappi",feedbackSource:"marketplace_import",note:"Depende de um adaptador da Fase 69 com a capacidade reviews_read."},
  tripadvisor:{name:"Tripadvisor",feedbackSource:"marketplace_import",note:"Sem integração oficial neste produto."},
};

export type ExternalReview={externalId:string;rating?:number|null;text?:string|null;authorLabel?:string|null;url?:string|null;reviewedAt:string;orderExternalRef?:string|null};
export interface ExternalReviewAdapter{
  readonly provider:string;
  readonly official:true;
  listReviews(input:{source:any;cursor?:string|null}):Promise<{reviews:ExternalReview[];nextCursor?:string|null}>;
  replyToReview?(input:{source:any;externalId:string;text:string}):Promise<{externalRef:string}>;
}
// No provider has an adapter in this repository yet. Registering one here is the only way to activate a source.
export const OFFICIAL_ADAPTERS:Record<string,ExternalReviewAdapter>={};

export class ExternalReviewSupportService{
  resolve(provider:string,adapters:Record<string,ExternalReviewAdapter>=OFFICIAL_ADAPTERS){
    const known=EXTERNAL_PROVIDERS[provider];
    if(!known)return{supported:false,status:"not_supported",reason:"Provedor sem integração oficial."};
    const adapter=adapters[provider];
    if(!adapter||adapter.official!==true)return{supported:false,status:"not_supported",reason:known.note};
    return{supported:true,status:"pending_credentials",reason:null,canReply:typeof adapter.replyToReview==="function"};
  }
}

const FAILURE_LIMIT=3,COOLDOWN_MS=30*6e4;
export class ExternalSyncCircuit{
  isOpen(source:{circuit_open_until?:string|null},now=Date.now()){return Boolean(source.circuit_open_until&&Date.parse(source.circuit_open_until)>now)}
  afterFailure(source:{consecutive_failures?:number},now=Date.now()){const failures=Number(source.consecutive_failures||0)+1;return{consecutive_failures:failures,status:"error",circuit_open_until:failures>=FAILURE_LIMIT?new Date(now+COOLDOWN_MS).toISOString():null}}
  afterSuccess(){return{consecutive_failures:0,status:"active",circuit_open_until:null,last_error:null}}
}
// Keeps only a first name and an initial, enough to tell reviews apart without copying a profile.
export const safeAuthorLabel=(name:unknown)=>{const parts=String(name||"").trim().split(/\s+/).filter(Boolean);return parts.length?`${parts[0].slice(0,30)}${parts[1]?` ${parts[1][0]}.`:""}`:null};

export async function ingestExternalReviews(ctx:{admin:any},source:any,reviews:ExternalReview[]){
  const provider=EXTERNAL_PROVIDERS[source.provider];let created=0,updated=0;
  for(const review of reviews){
    const rating=review.rating==null?null:Math.min(5,Math.max(1,Math.round(Number(review.rating)))),comment=source.retain_text===false?null:String(review.text||"").slice(0,4000)||null,{data:existing}=await ctx.admin.from("external_reviews").select("id,feedback_id").eq("source_id",source.id).eq("external_id",review.externalId).maybeSingle();
    if(existing){await ctx.admin.from("crm_feedback").update({rating,comment}).eq("id",existing.feedback_id);await ctx.admin.from("external_reviews").update({provider_rating:review.rating??null,updated_at:new Date().toISOString()}).eq("id",existing.id);updated++;continue}
    const{data:feedback,error}=await ctx.admin.from("crm_feedback").insert({establishment_id:source.store_id,organization_id:source.organization_id,rating,comment,source:provider.feedbackSource,channel:source.provider,feedback_type:"star_rating",scale:"1-5",is_public:true,answered_at:review.reviewedAt}).select("id").single();
    if(error)throw new Error(error.message);
    const{error:linkError}=await ctx.admin.from("external_reviews").insert({organization_id:source.organization_id,store_id:source.store_id,source_id:source.id,feedback_id:feedback.id,external_id:review.externalId,provider_url:review.url||null,author_label:safeAuthorLabel(review.authorLabel),provider_rating:review.rating??null,reviewed_at:review.reviewedAt});
    if(linkError)throw new Error(linkError.message);
    created++;
  }
  return{created,updated};
}

export async function syncSource(ctx:{admin:any;adapters?:Record<string,ExternalReviewAdapter>;now?:number},source:any){
  const circuit=new ExternalSyncCircuit(),now=ctx.now??Date.now(),adapter=(ctx.adapters||OFFICIAL_ADAPTERS)[source.provider];
  if(!adapter||adapter.official!==true){await ctx.admin.from("external_review_sources").update({status:"not_supported",support_reason:EXTERNAL_PROVIDERS[source.provider]?.note||"Sem integração oficial.",updated_at:new Date(now).toISOString()}).eq("id",source.id);return{status:"not_supported",imported:0}}
  if(source.status!=="active"&&source.status!=="error")return{status:source.status,imported:0};
  if(circuit.isOpen(source,now))return{status:"circuit_open",imported:0};
  try{
    const page=await adapter.listReviews({source,cursor:source.sync_cursor}),result=await ingestExternalReviews(ctx,source,page.reviews);
    await ctx.admin.from("external_review_sources").update({...circuit.afterSuccess(),sync_cursor:page.nextCursor??source.sync_cursor,last_sync_at:new Date(now).toISOString(),updated_at:new Date(now).toISOString()}).eq("id",source.id);
    return{status:"active",imported:result.created,updated:result.updated};
  }catch(error:any){
    await ctx.admin.from("external_review_sources").update({...circuit.afterFailure(source,now),last_error:String(error?.message||"Falha").slice(0,300),updated_at:new Date(now).toISOString()}).eq("id",source.id);
    return{status:"error",imported:0};
  }
}
