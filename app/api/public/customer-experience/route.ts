/* eslint-disable @typescript-eslint/no-explicit-any */
import{NextResponse}from"next/server";import{createAdminClient}from"@/lib/supabase/admin";import{cxAudit}from"@/lib/customer-experience/server";import{ReviewInviteService,hashRequester,hashToken}from"@/lib/customer-experience/surveys";
const SOURCES=["whatsapp","qr_table","receipt_link","kiosk","customer_portal"],KNOWN_ERRORS:Record<string,number>={CX_SURVEY_UNAVAILABLE:404,CX_ALREADY_ANSWERED:409,CX_SURVEY_EXPIRED:410,CX_RATE_LIMITED:429,CX_SCORE_INVALID:422};
const reply=(body:any,status=200)=>NextResponse.json(body,{status,headers:{"cache-control":"no-store"}});
const clean=(value:unknown,limit:number)=>value&&typeof value==="object"&&JSON.stringify(value).length<=limit?value:null;
// The answer is public and anonymous. The address only limits abuse: it is stored hashed, with a salt that changes every day.
const requesterHash=(req:Request)=>{const address=String(req.headers.get("cf-connecting-ip")||req.headers.get("x-forwarded-for")||"").split(",")[0].trim();return address?hashRequester(`${address}:${new Date().toISOString().slice(0,10)}`,process.env.CRON_SECRET||"customer-experience"):null};
export async function POST(req:Request){try{const body=await req.json(),slug=String(body.slug||"").slice(0,120),token=String(body.token||""),source=token?String(body.source||"whatsapp"):String(body.source||"qr_table");if(!slug||!SOURCES.includes(source))return reply({error:"CX_SURVEY_UNAVAILABLE"},404);
 const admin=createAdminClient(),{data,error}=await admin.rpc("cx_submit_survey_response",{requested_slug:slug,requested_token_hash:token?hashToken(token):null,requested_source:source,requested_score:Number(body.score),requested_comment:typeof body.comment==="string"?body.comment:null,requested_dimensions:clean(body.dimensions,2000),requested_items:clean(body.items,4000),requested_requester_hash:requesterHash(req)});
 if(error){const code=Object.keys(KNOWN_ERRORS).find(x=>error.message.includes(x));return reply({error:code||"CX_FAILED"},code?KNOWN_ERRORS[code]:500)}
 const{data:settings}=await admin.from("cx_settings").select("public_review_links").eq("organization_id",data.organization_id).maybeSingle(),service=new ReviewInviteService();
 await cxAudit(admin,{organizationId:data.organization_id,storeId:data.store_id,actorType:"customer",action:"survey_answered",resourceType:"crm_feedback",resourceId:data.feedback_id,metadata:{source}});
 return reply({ok:true,invite:service.invite({publicReviewUrl:(settings?.public_review_links as any)?.[data.store_id]}),contact:service.contactOffer({detractor:data.detractor,identified:data.identified})})
}catch{return reply({error:"CX_FAILED"},400)}}
