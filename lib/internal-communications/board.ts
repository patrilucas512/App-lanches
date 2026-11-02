/* eslint-disable @typescript-eslint/no-explicit-any */
/* Board and polls. There is no like, no counter per person and no ranking anywhere here, by design. */
import {AudienceResolver,loadAudienceUniverse,normalizeAudience} from "./audiences.ts";
import {checkContent,mustData} from "./core.ts";
import {commsAudit,commsSettings} from "./server.ts";

const need=(ctx:any,permission:string)=>{if(!ctx.permissions?.includes(permission))throw new Error("FORBIDDEN")};
const flag=(ctx:any,name:string)=>{if(!ctx.flags?.[name])throw new Error("FEATURE_DISABLED")};
function assertClean(text:string){const check=checkContent(text);if(!check.ok)throw new Error(`SENSITIVE_DATA_BLOCKED:${check.blocked.join(",")}`)}

export async function boardFor(ctx:any){
  const now=new Date().toISOString(),{data:posts}=await ctx.admin.from("comms_board_posts").select("*").eq("organization_id",ctx.organizationId).eq("status","active").or(`store_id.is.null,store_id.in.(${ctx.storeIds.join(",")})`).or(`expires_at.is.null,expires_at.gt.${now}`).order("pinned",{ascending:false}).order("created_at",{ascending:false}).limit(100);
  const ids=(posts||[]).map((x:any)=>x.id),{data:comments}=ids.length?await ctx.admin.from("comms_board_comments").select("id,post_id,body,created_at").in("post_id",ids).eq("status","approved").order("created_at").limit(500):{data:[]};
  return(posts||[]).map((x:any)=>({...x,comments:(comments||[]).filter((c:any)=>c.post_id===x.id)}));
}

export async function createBoardPost(ctx:any,input:any){
  flag(ctx,"comms_board_enabled");
  const network=input.scope==="network",type=String(input.post_type||"quick_notice"),title=String(input.title||"").trim(),body=String(input.body||"").trim()||null;
  need(ctx,network?"comms:publish_network":"comms:publish_unit");
  if(!["pinned_announcement","quick_notice","important_date"].includes(type))throw new Error("TYPE_INVALID");
  if(title.length<3||title.length>180)throw new Error("TITLE_REQUIRED");
  assertClean(`${title}\n${body||""}`);
  let announcementId=null;
  if(type==="pinned_announcement"){
    const{data:a}=await ctx.admin.from("network_announcements").select("id,status").eq("id",String(input.announcement_id||"")).eq("organization_id",ctx.organizationId).maybeSingle();
    if(a?.status!=="published")throw new Error("ANNOUNCEMENT_NOT_PUBLISHED");
    announcementId=a.id;
  }
  // A network-wide notice needs approval as an announcement. It cannot take the board as a shorter way around that.
  if(network&&type==="quick_notice")throw new Error("NETWORK_NOTICE_NEEDS_ANNOUNCEMENT");
  const settings=await commsSettings(ctx.admin,ctx.organizationId),data=mustData(await ctx.admin.from("comms_board_posts").insert({organization_id:ctx.organizationId,store_id:network?null:ctx.storeId,announcement_id:announcementId,post_type:type,title,body,event_date:input.event_date||null,pinned:type==="pinned_announcement"||Boolean(input.pinned),expires_at:input.expires_at||null,comments_enabled:settings.board_comments_enabled&&Boolean(input.comments_enabled),created_by:ctx.actorId}).select().single(),"criar aviso");
  await commsAudit(ctx.admin,{organizationId:ctx.organizationId,storeId:data.store_id,actorId:ctx.actorId,action:"board_post_created",resourceType:"comms_board_post",resourceId:data.id,metadata:{type}});
  return{post:data};
}

export async function removeBoardPost(ctx:any,input:{id:string;reason:string}){
  need(ctx,"comms:moderate_board");
  if(String(input.reason||"").trim().length<3)throw new Error("REASON_REQUIRED");
  let query=ctx.admin.from("comms_board_posts").update({status:"removed"}).eq("id",input.id).eq("organization_id",ctx.organizationId);
  if(!ctx.allStores)query=query.in("store_id",ctx.storeIds);
  const{data}=await query.select().maybeSingle();
  if(!data)throw new Error("POST_NOT_FOUND");
  await commsAudit(ctx.admin,{organizationId:ctx.organizationId,storeId:data.store_id,actorId:ctx.actorId,action:"board_post_removed",resourceType:"comms_board_post",resourceId:data.id,reason:input.reason});
  return{post:data};
}

export async function addComment(ctx:any,input:{postId:string;body:string}){
  flag(ctx,"comms_board_enabled");
  const body=String(input.body||"").trim();
  if(body.length<2||body.length>1000)throw new Error("COMMENT_REQUIRED");
  assertClean(body);
  const{data:post}=await ctx.admin.from("comms_board_posts").select("id,store_id,comments_enabled,status").eq("id",input.postId).eq("organization_id",ctx.organizationId).maybeSingle();
  if(!post||post.status!=="active"||(post.store_id&&!ctx.storeIds.includes(post.store_id)))throw new Error("POST_NOT_FOUND");
  const settings=await commsSettings(ctx.admin,ctx.organizationId);
  if(!post.comments_enabled||!settings.board_comments_enabled)throw new Error("COMMENTS_DISABLED");
  return{comment:mustData(await ctx.admin.from("comms_board_comments").insert({post_id:post.id,organization_id:ctx.organizationId,author_id:ctx.actorId,body,status:"pending"}).select("id,status").single(),"comentar")};
}

export async function moderateComment(ctx:any,input:{id:string;decision:"approved"|"rejected"}){
  need(ctx,"comms:moderate_board");
  const{data:comment}=await ctx.admin.from("comms_board_comments").select("id,post_id,comms_board_posts(store_id)").eq("id",input.id).eq("organization_id",ctx.organizationId).maybeSingle();
  const storeId=(comment as any)?.comms_board_posts?.store_id;
  if(!comment||(!ctx.allStores&&!ctx.storeIds.includes(storeId)))throw new Error("COMMENT_NOT_FOUND");
  const data=mustData(await ctx.admin.from("comms_board_comments").update({status:input.decision,moderated_by:ctx.actorId,moderated_at:new Date().toISOString()}).eq("id",comment.id).select().single(),"moderar");
  await commsAudit(ctx.admin,{organizationId:ctx.organizationId,storeId,actorId:ctx.actorId,action:`comment_${input.decision}`,resourceType:"comms_board_comment",resourceId:comment.id});
  return{comment:data};
}

const resolver=new AudienceResolver();
const isNetworkScope=(definition:any)=>!["store","team"].includes(definition.scope.type);

export async function createPoll(ctx:any,input:any){
  flag(ctx,"comms_polls_enabled");
  need(ctx,"comms:create");
  const question=String(input.question||"").trim(),labels=(Array.isArray(input.options)?input.options:[]).map((x:unknown)=>String(x||"").trim()).filter(Boolean),definition=normalizeAudience(input.audience);
  if(question.length<3||question.length>300)throw new Error("QUESTION_REQUIRED");
  if(labels.length<2||labels.length>6||new Set(labels).size!==labels.length)throw new Error("OPTIONS_INVALID");
  assertClean(`${question}\n${labels.join("\n")}`);
  need(ctx,isNetworkScope(definition)?"comms:publish_network":"comms:publish_unit");
  const universe=await loadAudienceUniverse(ctx.admin,ctx.organizationId,definition);
  if(!ctx.allStores&&resolver.targetStores(definition,universe).some(id=>!ctx.storeIds.includes(id)))throw new Error("FORBIDDEN");
  const settings=await commsSettings(ctx.admin,ctx.organizationId),poll=mustData(await ctx.admin.from("comms_polls").insert({organization_id:ctx.organizationId,store_id:ctx.storeId,question,status:"open",audience_definition:definition,anonymous:input.anonymous!==false,minimum_responses:Math.max(settings.poll_minimum_responses,3),closes_at:input.closes_at||null,created_by:ctx.actorId}).select().single(),"criar enquete");
  mustData(await ctx.admin.from("comms_poll_options").insert(labels.map((label:string,position:number)=>({poll_id:poll.id,label,position}))).select(),"opções da enquete");
  await commsAudit(ctx.admin,{organizationId:ctx.organizationId,storeId:ctx.storeId,actorId:ctx.actorId,action:"poll_created",resourceType:"comms_poll",resourceId:poll.id,metadata:{anonymous:poll.anonymous}});
  return{poll};
}

export async function vote(ctx:any,input:{pollId:string;optionId:string}){
  flag(ctx,"comms_polls_enabled");
  const{data:poll}=await ctx.admin.from("comms_polls").select("*").eq("id",input.pollId).eq("organization_id",ctx.organizationId).maybeSingle();
  if(!poll)throw new Error("POLL_NOT_FOUND");
  if(poll.status!=="open"||(poll.closes_at&&Date.parse(poll.closes_at)<=Date.now()))throw new Error("POLL_CLOSED");
  const definition=normalizeAudience(poll.audience_definition),universe=await loadAudienceUniverse(ctx.admin,ctx.organizationId,definition);
  if(!resolver.resolve(definition,universe).some(x=>x.userId===ctx.actorId))throw new Error("POLL_NOT_FOUND");
  const{data:option}=await ctx.admin.from("comms_poll_options").select("id").eq("id",input.optionId).eq("poll_id",poll.id).maybeSingle();
  if(!option)throw new Error("OPTION_INVALID");
  const{error:joined}=await ctx.admin.from("comms_poll_participation").insert({poll_id:poll.id,user_id:ctx.actorId});
  if(joined)throw new Error(joined.code==="23505"?"ALREADY_VOTED":joined.message);
  const{error}=await ctx.admin.from("comms_poll_responses").insert({poll_id:poll.id,option_id:option.id,identified_user_id:poll.anonymous?null:ctx.actorId});
  if(error){await ctx.admin.from("comms_poll_participation").delete().eq("poll_id",poll.id).eq("user_id",ctx.actorId);throw new Error(error.message)}
  return{voted:true};
}

// Below the minimum there is no breakdown at all: in a team of three, "two said no" identifies people.
export function aggregatePoll(input:{minimum:number;options:Array<{id:string;label:string}>;responses:Array<{option_id:string}>}){
  const total=input.responses.length;
  if(total<input.minimum)return{status:"insufficient_responses" as const,minimum:input.minimum,responses:total,options:input.options.map(x=>({id:x.id,label:x.label,count:null,percent:null}))};
  return{status:"ok" as const,minimum:input.minimum,responses:total,options:input.options.map(x=>{const count=input.responses.filter(r=>r.option_id===x.id).length;return{id:x.id,label:x.label,count,percent:Math.round(count/total*1000)/10}})};
}

export async function pollsFor(ctx:any){
  const{data:polls}=await ctx.admin.from("comms_polls").select("id,question,status,closes_at,anonymous,minimum_responses,audience_definition,store_id,created_at").eq("organization_id",ctx.organizationId).order("created_at",{ascending:false}).limit(50);
  const out:any[]=[];
  for(const poll of polls||[]){
    const definition=normalizeAudience(poll.audience_definition),universe=await loadAudienceUniverse(ctx.admin,ctx.organizationId,definition),inAudience=resolver.resolve(definition,universe).some(x=>x.userId===ctx.actorId),canSee=ctx.permissions?.includes("comms:view")&&(ctx.allStores||resolver.targetStores(definition,universe).some(id=>ctx.storeIds.includes(id)));
    if(!inAudience&&!canSee)continue;
    const[{data:options},{data:responses},{data:mine}]=await Promise.all([ctx.admin.from("comms_poll_options").select("id,label,position").eq("poll_id",poll.id).order("position"),ctx.admin.from("comms_poll_responses").select("option_id").eq("poll_id",poll.id).limit(20000),ctx.admin.from("comms_poll_participation").select("user_id").eq("poll_id",poll.id).eq("user_id",ctx.actorId).maybeSingle()]);
    const rest={...poll};delete rest.audience_definition;
    out.push({...rest,canVote:inAudience&&!mine&&poll.status==="open"&&(!poll.closes_at||Date.parse(poll.closes_at)>Date.now()),voted:Boolean(mine),results:aggregatePoll({minimum:poll.minimum_responses,options:options||[],responses:responses||[]})});
  }
  return out;
}

export async function closePoll(ctx:any,input:{id:string}){
  need(ctx,"comms:create");
  let query=ctx.admin.from("comms_polls").update({status:"closed"}).eq("id",input.id).eq("organization_id",ctx.organizationId);
  if(!ctx.allStores)query=query.in("store_id",ctx.storeIds);
  const{data}=await query.select("id,status,store_id").maybeSingle();
  if(!data)throw new Error("POLL_NOT_FOUND");
  await commsAudit(ctx.admin,{organizationId:ctx.organizationId,storeId:data.store_id,actorId:ctx.actorId,action:"poll_closed",resourceType:"comms_poll",resourceId:data.id});
  return{poll:data};
}
