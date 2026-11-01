/* eslint-disable @typescript-eslint/no-explicit-any */
/* The employee side, and who may see what did not get read. */
import {mustData} from "./core.ts";
import {commsAudit} from "./server.ts";

const VISIBLE_STATUSES=["published","retracted"];

// The right answer of a verification question never goes to the browser.
export const publicAnnouncement=(a:any)=>{const out={...a,verification:a.verification?{question:a.verification.question,options:a.verification.options}:null};delete out.pending_edit;delete out.approved_hash;return out};

export async function myFeed(ctx:any,options:{limit?:number}={}){
  const{data:rows}=await ctx.admin.from("network_announcement_recipients").select("announcement_id,state,required_version,ack_due_at,opened_at,acknowledged_at,store_id").eq("organization_id",ctx.organizationId).eq("user_id",ctx.actorId).order("created_at",{ascending:false}).limit(options.limit||100);
  const ids=(rows||[]).map((x:any)=>x.announcement_id);
  if(!ids.length)return{items:[],mandatoryPending:0};
  const[{data:list},{data:files}]=await Promise.all([ctx.admin.from("network_announcements").select("*").in("id",ids).eq("organization_id",ctx.organizationId).in("status",VISIBLE_STATUSES),ctx.admin.from("comms_attachments").select("id,announcement_id,file_name,mime_type,size_bytes").in("announcement_id",ids)]);
  const byId=new Map((list||[]).map((x:any)=>[x.id,x])),now=Date.now();
  const items=(rows||[]).flatMap((r:any)=>{const a:any=byId.get(r.announcement_id);if(!a||(a.status==="published"&&a.expires_at&&Date.parse(a.expires_at)<=now))return[];return[{...publicAnnouncement(a),receipt:{state:r.state,ack_due_at:r.ack_due_at,opened_at:r.opened_at,acknowledged_at:r.acknowledged_at},attachments:(files||[]).filter((f:any)=>f.announcement_id===a.id)}]});
  const open=(x:any)=>x.status==="published"&&x.acknowledgement_required&&x.receipt.state!=="acknowledged";
  items.sort((a:any,b:any)=>Number(open(b))-Number(open(a)));
  return{items,mandatoryPending:items.filter(open).length};
}

async function receiptOf(ctx:any,id:string){
  const{data}=await ctx.admin.from("network_announcement_recipients").select("*").eq("announcement_id",id).eq("user_id",ctx.actorId).eq("organization_id",ctx.organizationId).maybeSingle();
  // Not on the list is the same as not existing: it does not reveal that the announcement is there.
  if(!data)throw new Error("ANNOUNCEMENT_NOT_FOUND");
  return data;
}

export async function markOpened(ctx:any,input:{id:string}){
  const r=await receiptOf(ctx,input.id);
  if(r.opened_at)return{opened:true};
  await ctx.admin.from("network_announcement_recipients").update({opened_at:new Date().toISOString(),state:["pending","delivered"].includes(r.state)?"opened":r.state}).eq("announcement_id",input.id).eq("user_id",ctx.actorId);
  return{opened:true};
}

export async function acknowledge(ctx:any,input:{id:string;answerIndex?:number}){
  const r=await receiptOf(ctx,input.id),a=mustData(await ctx.admin.from("network_announcements").select("*").eq("id",input.id).single(),"ler comunicado");
  if(a.status!=="published")throw new Error("STATUS_INVALID");
  if(!a.acknowledgement_required)throw new Error("ACK_NOT_REQUIRED");
  if(r.state==="acknowledged"&&r.required_version===a.version)return{acknowledged:true,alreadyAcknowledged:true,version:a.version};
  let passed:boolean|null=null;
  // A wrong answer is not stored anywhere. It only asks the person to read it again; it is not a test score.
  if(a.verification){passed=Number(input.answerIndex)===Number(a.verification.correct_index);if(!passed)throw new Error("VERIFICATION_FAILED")}
  const now=new Date().toISOString();
  mustData(await ctx.admin.from("network_announcement_acknowledgements").upsert({announcement_id:a.id,user_id:ctx.actorId,store_id:r.store_id,acknowledged_at:now,version:a.version,verification_passed:passed},{onConflict:"announcement_id,user_id"}).select().single(),"confirmar leitura");
  await ctx.admin.from("network_announcement_recipients").update({state:"acknowledged",acknowledged_at:now,opened_at:r.opened_at||now}).eq("announcement_id",a.id).eq("user_id",ctx.actorId);
  if(r.inbox_item_id)await ctx.admin.from("notification_inbox_items").update({status:"resolved",resolved_at:now,acknowledged_at:now}).eq("id",r.inbox_item_id).eq("recipient_user_id",ctx.actorId);
  await commsAudit(ctx.admin,{organizationId:ctx.organizationId,storeId:r.store_id,actorId:ctx.actorId,action:"acknowledged",resourceType:"network_announcement",resourceId:a.id,metadata:{version:a.version}});
  return{acknowledged:true,alreadyAcknowledged:false,version:a.version};
}

async function scopedRecipients(ctx:any,id:string){
  let query=ctx.admin.from("network_announcement_recipients").select("user_id,store_id,state,delivery_status,ack_due_at").eq("announcement_id",id).eq("organization_id",ctx.organizationId);
  if(!ctx.allStores)query=query.in("store_id",ctx.storeIds);
  const{data}=await query.limit(5000);
  return data||[];
}

// Numbers per unit, for mandatory announcements only. For the rest, a total: a small team's open rate would point at people.
export async function acknowledgementSummary(ctx:any,input:{id:string}){
  const{data:a}=await ctx.admin.from("network_announcements").select("id,title,acknowledgement_required,ack_deadline,version").eq("id",input.id).eq("organization_id",ctx.organizationId).maybeSingle();
  if(!a)throw new Error("ANNOUNCEMENT_NOT_FOUND");
  const rows=await scopedRecipients(ctx,a.id),count=(list:any[],state:string)=>list.filter(x=>x.state===state).length;
  const totals={recipients:rows.length,acknowledged:count(rows,"acknowledged"),overdue:count(rows,"overdue"),pending:rows.filter((x:any)=>!["acknowledged"].includes(x.state)).length};
  if(!a.acknowledgement_required)return{announcement:a,totals:{recipients:rows.length},units:[]};
  const storeIds=[...new Set(rows.map((x:any)=>x.store_id).filter(Boolean))],{data:stores}=storeIds.length?await ctx.admin.from("establishments").select("id,name").in("id",storeIds):{data:[]},name=new Map((stores||[]).map((x:any)=>[x.id,x.name]));
  const units=storeIds.map((id:any)=>{const list=rows.filter((x:any)=>x.store_id===id);return{store_id:id,name:name.get(id)||"Unidade",recipients:list.length,acknowledged:count(list,"acknowledged"),overdue:count(list,"overdue"),confirmed:list.every((x:any)=>x.state==="acknowledged")}}).sort((x:any,y:any)=>Number(x.confirmed)-Number(y.confirmed));
  return{announcement:a,totals,units};
}

// The only named list in the module: mandatory announcement, permission held, own units only, and every look is on the audit trail.
export async function pendingPeople(ctx:any,input:{id:string}){
  if(!ctx.permissions?.includes("comms:view_ack_status"))throw new Error("FORBIDDEN");
  const{data:a}=await ctx.admin.from("network_announcements").select("id,acknowledgement_required,store_id").eq("id",input.id).eq("organization_id",ctx.organizationId).maybeSingle();
  if(!a)throw new Error("ANNOUNCEMENT_NOT_FOUND");
  if(!a.acknowledgement_required)throw new Error("ACK_NOT_REQUIRED");
  const rows=(await scopedRecipients(ctx,a.id)).filter((x:any)=>x.state!=="acknowledged");
  const users=[...new Set(rows.map((x:any)=>x.user_id))],{data:people}=users.length?await ctx.admin.from("profiles").select("id,full_name").in("id",users):{data:[]},name=new Map((people||[]).map((x:any)=>[x.id,x.full_name]));
  await commsAudit(ctx.admin,{organizationId:ctx.organizationId,storeId:ctx.storeId,actorId:ctx.actorId,action:"ack_status_viewed",resourceType:"network_announcement",resourceId:a.id,metadata:{listed:rows.length}});
  return{pending:rows.map((x:any)=>({name:name.get(x.user_id)||"Pessoa sem nome",store_id:x.store_id,state:x.state,ack_due_at:x.ack_due_at}))};
}
