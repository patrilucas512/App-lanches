/* eslint-disable @typescript-eslint/no-explicit-any */
import{NextResponse}from"next/server";import{createClient}from"@/lib/supabase/server";import{createAdminClient}from"@/lib/supabase/admin";import{publishNotification}from"@/lib/notifications/publisher";import{decide}from"@/lib/policy_engine/services";
import{COMMS_FLAGS,CommsAccessService}from"@/lib/internal-communications/core";import{commsAudit,commsSettings,COMMS_SETTINGS_DEFAULTS}from"@/lib/internal-communications/server";import{archiveAnnouncement,completeEmergencyReview,createDraft,decideApproval,editAnnouncement,previewAudience,publishAnnouncement,retractAnnouncement,scheduleAnnouncement,submitForApproval}from"@/lib/internal-communications/announcements";import{acknowledge,acknowledgementSummary,markOpened,myFeed,pendingPeople}from"@/lib/internal-communications/acknowledgements";import{activeTemplate,attachmentLink,deadlineFromTemplate,renderTemplate,requestAttachmentUpload,saveTemplate}from"@/lib/internal-communications/templates";import{addComment,boardFor,closePoll,createBoardPost,createPoll,moderateComment,pollsFor,removeBoardPost,vote}from"@/lib/internal-communications/board";import{commsCopilot,simplifyText,summarizeText}from"@/lib/internal-communications/integrations";import{commsDashboard}from"@/lib/internal-communications/dashboard";import{runDelivery}from"@/lib/internal-communications/delivery";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,STATUS:Record<string,number>={AUTH:401,FORBIDDEN:403,FEATURE_DISABLED:403,ANNOUNCEMENT_NOT_FOUND:404,ATTACHMENT_NOT_FOUND:404,POLL_NOT_FOUND:404,POST_NOT_FOUND:404,COMMENT_NOT_FOUND:404,TEMPLATE_NOT_FOUND:404},response=(body:any,status=200)=>NextResponse.json(body,{status,headers:{"cache-control":"private, no-store","x-content-type-options":"nosniff"}});
const id=(value:unknown)=>{if(!value||!UUID.test(String(value)))throw new Error("INVALID_ID");return String(value)};
const fail=(error:any)=>{const message=String(error?.message||"Falha na comunicação interna."),code=message.split(":")[0].split(",")[0];return response({error:message},STATUS[code]||(/^[A-Z_,:]+$/.test(message)?422:500))};
async function context(storeId:string){
 if(!UUID.test(storeId))throw new Error("FORBIDDEN");
 const client=await createClient(),{data}=await client.auth.getClaims(),userId=String(data?.claims?.sub||"");if(!userId)throw new Error("AUTH");
 const admin=createAdminClient(),{data:store}=await admin.from("establishments").select("id,organization_id").eq("id",storeId).maybeSingle();if(!store)throw new Error("FORBIDDEN");
 const flagsList=COMMS_FLAGS.join(","),[{data:local},{data:org},{data:custom},{data:flagRow},{data:subscription}]=await Promise.all([admin.from("establishment_members").select("role").eq("establishment_id",storeId).eq("user_id",userId).eq("status","active").maybeSingle(),admin.from("organization_members").select("role,all_stores").eq("organization_id",store.organization_id).eq("user_id",userId).eq("active",true).maybeSingle(),admin.from("comms_member_permissions").select("permission_key").eq("organization_id",store.organization_id).eq("user_id",userId).eq("active",true),admin.from("store_feature_flags").select(flagsList).eq("establishment_id",storeId).maybeSingle(),admin.from("subscriptions").select(`plans(${flagsList})`).eq("establishment_id",storeId).in("status",["active","trialing","past_due"]).order("created_at",{ascending:false}).limit(1).maybeSingle()]);
 if(!local&&!org)throw new Error("FORBIDDEN");
 const plan:any=(subscription as any)?.plans,flags=Object.fromEntries(COMMS_FLAGS.map(f=>[f,(flagRow as any)?.[f]===true||plan?.[f]===true])) as Record<string,boolean>;
 if(!flags.internal_communications_enabled)throw new Error("FEATURE_DISABLED");
 const allStores=Boolean(org&&(["owner","admin"].includes(org.role)||org.all_stores));let storeIds=[storeId];
 if(allStores){const{data:stores}=await admin.from("establishments").select("id").eq("organization_id",store.organization_id);storeIds=(stores||[]).map((x:any)=>x.id)}
 return{admin,organizationId:store.organization_id,storeId,storeIds,allStores,actorId:userId,permissions:new CommsAccessService().resolve({orgRole:org?.role,storeRole:local?.role,explicit:(custom||[]).map((x:any)=>x.permission_key)}),flags,notify:publishNotification,policyDecide:decide};
}
const need=(ctx:any,p:string)=>{if(!ctx.permissions.includes(p))throw new Error("FORBIDDEN")};
// Delivery is a queue. Trying once right after publishing only saves the wait; the worker picks up whatever this does not finish.
async function deliverNow(ctx:any,announcementId:string){try{await runDelivery({admin:ctx.admin,notify:ctx.notify},announcementId,{limit:100})}catch{/* The job stays queued. */}}
const draftInput=(body:any)=>({type:body.type,priority:body.priority,title:body.title,body:body.body,requiresAck:body.requires_ack,ackDeadline:body.ack_deadline,publishAt:body.publish_at,expiresAt:body.expires_at,audience:body.audience,relatedRefs:body.related_refs,verification:body.verification,templateId:body.template_id?id(body.template_id):null});
export async function GET(req:Request){try{const params=new URL(req.url).searchParams,view=String(params.get("view")||"center"),ctx=await context(String(params.get("store_id")||""));
 if(view==="feed"){const[feed,board,polls]=await Promise.all([myFeed(ctx),ctx.flags.comms_board_enabled?boardFor(ctx):Promise.resolve([]),ctx.flags.comms_polls_enabled?pollsFor(ctx):Promise.resolve([])]);const{data:profile}=await ctx.admin.from("profiles").select("preferred_language").eq("id",ctx.actorId).maybeSingle();return response({...feed,board,polls,flags:ctx.flags,preferredLanguage:profile?.preferred_language||null})}
 need(ctx,"comms:view");
 if(view==="acknowledgements")return response(await acknowledgementSummary(ctx,{id:id(params.get("id"))}));
 const[dashboard,board,polls,comments]=await Promise.all([commsDashboard(ctx),ctx.flags.comms_board_enabled?boardFor(ctx):Promise.resolve([]),ctx.flags.comms_polls_enabled?pollsFor(ctx):Promise.resolve([]),ctx.permissions.includes("comms:moderate_board")?ctx.admin.from("comms_board_comments").select("id,post_id,body,created_at").eq("organization_id",ctx.organizationId).eq("status","pending").limit(50):Promise.resolve({data:[]})]);
 return response({...dashboard,board,polls,pendingComments:(comments as any).data||[]})
}catch(error:any){return fail(error)}}
async function run(ctx:any,action:string,body:any):Promise<any>{switch(action){
 case"preview_audience":need(ctx,"comms:create");return previewAudience(ctx,body.audience);
 case"create_draft":return createDraft(ctx,draftInput(body));
 case"draft_from_template":{need(ctx,"comms:create");const template=await activeTemplate(ctx.admin,ctx.organizationId,String(body.template_key||"")),rendered=renderTemplate(template,body.values||{});return{...rendered,template:{id:template.id,type:template.announcement_type,priority:template.priority,requires_ack:template.requires_ack,ack_deadline:deadlineFromTemplate(template),variables:template.variables}}}
 case"edit":{const result=await editAnnouncement(ctx,{id:id(body.id),title:body.title,body:body.body,material:body.material===true,note:body.note,confirmSensitive:body.confirm_sensitive===true,fields:body.fields});if((result as any).requiresNewAck)await deliverNow(ctx,id(body.id));return result}
 case"submit":return submitForApproval(ctx,{id:id(body.id),confirmSensitive:body.confirm_sensitive===true});
 case"decide":return decideApproval(ctx,{id:id(body.id),decision:body.decision==="approved"?"approved":"rejected",reason:String(body.reason||"")});
 case"schedule":return scheduleAnnouncement(ctx,{id:id(body.id),publishAt:String(body.publish_at||""),confirmSensitive:body.confirm_sensitive===true});
 case"publish":{const result:any=await publishAnnouncement(ctx,{id:id(body.id),confirmSensitive:body.confirm_sensitive===true,emergency:body.emergency===true,reason:body.reason});await deliverNow(ctx,result.announcement.id);return result}
 case"emergency_review":return completeEmergencyReview(ctx,{id:id(body.id),notes:String(body.notes||"")});
 case"retract":{const result:any=await retractAnnouncement(ctx,{id:id(body.id),reason:String(body.reason||""),correction:body.correction});await deliverNow(ctx,result.announcement.id);return result}
 case"archive":return archiveAnnouncement(ctx,{id:id(body.id)});
 case"open":return markOpened(ctx,{id:id(body.id)});
 case"acknowledge":return acknowledge(ctx,{id:id(body.id),answerIndex:body.answer_index});
 case"pending_people":return pendingPeople(ctx,{id:id(body.id)});
 case"save_template":return saveTemplate(ctx,body);
 case"attachment_upload":return requestAttachmentUpload(ctx,{id:id(body.id),fileName:String(body.file_name||""),mimeType:String(body.mime_type||""),sizeBytes:Number(body.size_bytes)});
 case"attachment_link":return attachmentLink(ctx,{attachmentId:id(body.attachment_id)});
 case"board_post":return createBoardPost(ctx,body);
 case"board_remove":return removeBoardPost(ctx,{id:id(body.id),reason:String(body.reason||"")});
 case"board_comment":return addComment(ctx,{postId:id(body.post_id),body:String(body.body||"")});
 case"moderate_comment":return moderateComment(ctx,{id:id(body.id),decision:body.decision==="approved"?"approved":"rejected"});
 case"create_poll":return createPoll(ctx,body);
 case"vote":return vote(ctx,{pollId:id(body.poll_id),optionId:id(body.option_id)});
 case"close_poll":return closePoll(ctx,{id:id(body.id)});
 case"set_language":{const language=body.language||null;if(language!==null&&!["pt-BR","en","es"].includes(language))throw new Error("LANGUAGE_INVALID");const{error}=await ctx.admin.from("profiles").update({preferred_language:language}).eq("id",ctx.actorId);if(error)throw new Error(error.message);return{ok:true}}
 case"ai_assist":{need(ctx,"comms:create");if(!ctx.flags.comms_ai_drafts_enabled)throw new Error("FEATURE_DISABLED");const text=String(body.body||"");return{text:body.mode==="summarize"?summarizeText(text):simplifyText(text),canPublish:false}}
 case"update_settings":{need(ctx,"comms:manage_governance");const patch:any={};for(const key of Object.keys(COMMS_SETTINGS_DEFAULTS))if(key in body.settings)patch[key]=body.settings[key];const before=await commsSettings(ctx.admin,ctx.organizationId),{data,error}=await ctx.admin.from("comms_settings").upsert({organization_id:ctx.organizationId,...patch,updated_by:ctx.actorId,updated_at:new Date().toISOString()},{onConflict:"organization_id"}).select().single();if(error)throw new Error(error.message);await commsAudit(ctx.admin,{organizationId:ctx.organizationId,storeId:ctx.storeId,actorId:ctx.actorId,action:"settings_updated",resourceType:"comms_settings",resourceId:ctx.organizationId,metadata:{before,after:patch}});return{settings:data}}
 case"copilot":{need(ctx,"comms:view");return commsCopilot(String(body.tool),await commsDashboard(ctx),{body:body.body})}
 default:throw new Error("ACTION_INVALID");
}}
export async function POST(req:Request){try{const body=await req.json(),ctx=await context(String(body.store_id||""));return response(await run(ctx,String(body.action||""),body))}catch(error:any){return fail(error)}}
