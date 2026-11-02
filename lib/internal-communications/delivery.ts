/* eslint-disable @typescript-eslint/no-explicit-any */
/* Delivery goes through Phase 52 and nothing else. This file decides when, retries, and keeps the record per recipient. */
import {AudienceResolver,loadAudienceUniverse,normalizeAudience} from "./audiences.ts";
import {commsAudit,commsSettings,emitCommsEvent} from "./server.ts";
import {reminderDue} from "./core.ts";

const NOTIFICATION_PRIORITY:Record<string,string>={info:"low",important:"medium",mandatory:"high",urgent:"critical"};
export const notificationPriority=(priority:string)=>NOTIFICATION_PRIORITY[priority]||"medium";
export const MAX_DELIVERY_ATTEMPTS=5;
const feedRoute=(id:string)=>`/painel/comunicados?id=${id}`;

// Minutes until quiet hours end in the person's or store's own timezone, or 0 when they are not active. The server clock is not the person's clock.
export function quietMinutesLeft(quiet:any,timezone:string|null|undefined,now=new Date()){
  if(!quiet?.enabled)return 0;
  const parse=(value:string)=>{const[h,m]=value.split(":").map(Number);return h*60+(m||0)},from=parse(String(quiet.start||"22:00")),to=parse(String(quiet.end||"07:00"));
  let parts:Intl.DateTimeFormatPart[];
  try{parts=new Intl.DateTimeFormat("en-GB",{timeZone:timezone||"America/Sao_Paulo",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now)}catch{parts=new Intl.DateTimeFormat("en-GB",{timeZone:"America/Sao_Paulo",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now)}
  const minutes=Number(parts.find(x=>x.type==="hour")?.value)*60+Number(parts.find(x=>x.type==="minute")?.value);
  const active=from<=to?minutes>=from&&minutes<to:minutes>=from||minutes<to;
  return active?((to-minutes+1440)%1440||1440):0;
}

// Only an emergency publication, or urgency where the organization's policy says so, goes through quiet hours.
export function deliveryDecision(input:{priority:string;emergency?:boolean;bypassPolicy?:boolean;quietHours?:any;timezone?:string|null;now?:Date}){
  const now=input.now||new Date(),left=quietMinutesLeft(input.quietHours,input.timezone,now);
  if(!left||input.emergency||(input.priority==="urgent"&&input.bypassPolicy))return{deliver:true,until:null as string|null};
  return{deliver:false,until:new Date(now.getTime()+left*6e4).toISOString()};
}

export async function enqueueDelivery(admin:any,input:{organizationId:string;announcementId:string;crisis?:boolean}){
  const{error}=await admin.from("comms_jobs").insert({organization_id:input.organizationId,announcement_id:input.announcementId,job_type:"deliver",priority:input.crisis?100:50});
  // One active job per announcement already covers the new rows.
  if(error&&error.code!=="23505")throw new Error(error.message);
}

function messageFor(a:any){
  if(a.status==="retracted")return{eventType:"comms.retracted",title:`Comunicado retirado: ${a.title}`,summary:a.correction_note||"Este comunicado foi retirado. Desconsidere o conteúdo anterior.",requiresAction:false};
  const label=a.acknowledgement_required?"Confirmação de leitura obrigatória":a.priority==="urgent"?"Comunicado urgente":"Novo comunicado";
  return{eventType:a.version>1?"comms.version_changed":"comms.published",title:a.title,summary:label,requiresAction:Boolean(a.acknowledgement_required)};
}

export async function runDelivery(ctx:{admin:any;notify:any},announcementId:string,options:{limit?:number;now?:Date}={}){
  const admin=ctx.admin,now=options.now||new Date(),limit=options.limit||200;
  const{data:a}=await admin.from("network_announcements").select("*").eq("id",announcementId).maybeSingle();
  if(!a||!["published","retracted"].includes(a.status))return{sent:0,deferred:0,failed:0,remaining:0};
  const settings=await commsSettings(admin,a.organization_id),nowIso=now.toISOString();
  const{data:batch}=await admin.from("network_announcement_recipients").select("*").eq("announcement_id",a.id).in("delivery_status",["pending","deferred"]).lte("next_attempt_at",nowIso).order("next_attempt_at").limit(limit);
  const rows=batch||[];
  if(!rows.length)return{sent:0,deferred:0,failed:0,remaining:0};
  const users=rows.map((x:any)=>x.user_id),stores=[...new Set(rows.map((x:any)=>x.store_id).filter(Boolean))];
  const[{data:prefs},{data:tz}]=await Promise.all([admin.from("notification_user_preferences").select("user_id,quiet_hours,timezone,category").eq("organization_id",a.organization_id).in("user_id",users).in("category",["comms","operations"]),stores.length?admin.from("establishments").select("id,timezone").in("id",stores):Promise.resolve({data:[]})]);
  const pref=new Map<string,any>();for(const p of prefs||[])if(p.category==="comms"||!pref.has(p.user_id))pref.set(p.user_id,p);
  const zone=new Map((tz||[]).map((x:any)=>[x.id,x.timezone])),message=messageFor(a);
  let sent=0,deferred=0,failed=0;
  for(const r of rows){
    const p=pref.get(r.user_id),decision=a.status==="retracted"?{deliver:true,until:null}:deliveryDecision({priority:a.priority,emergency:a.emergency,bypassPolicy:settings.urgent_bypass_quiet_hours,quietHours:p?.quiet_hours,timezone:p?.timezone||zone.get(r.store_id),now});
    if(!decision.deliver){await admin.from("network_announcement_recipients").update({delivery_status:"deferred",next_attempt_at:decision.until}).eq("announcement_id",a.id).eq("user_id",r.user_id);deferred++;continue}
    try{
      const published=await ctx.notify(admin,{organizationId:a.organization_id,storeId:r.store_id,eventType:message.eventType,sourceType:"network_announcement",sourceId:a.id,title:message.title,summary:message.summary,priority:notificationPriority(a.priority),recipientUserId:r.user_id,requiresAction:message.requiresAction,actionDeadline:r.ack_due_at,route:feedRoute(a.id),allowedActions:["open"],metadata:{mandatory:Boolean(a.acknowledgement_required),version:a.version}});
      await admin.from("network_announcement_recipients").update({delivery_status:"sent",attempt_count:r.attempt_count+1,last_error:null,inbox_item_id:published?.item?.id||r.inbox_item_id||null,delivered_at:r.delivered_at||nowIso,state:r.state==="pending"?"delivered":r.state}).eq("announcement_id",a.id).eq("user_id",r.user_id);
      sent++;
    }catch(error:any){
      const attempts=r.attempt_count+1,dead=attempts>=MAX_DELIVERY_ATTEMPTS;
      await admin.from("network_announcement_recipients").update({delivery_status:dead?"failed":"pending",attempt_count:attempts,last_error:String(error?.message||"Falha").slice(0,300),next_attempt_at:new Date(now.getTime()+Math.min(36e5,3e4*2**attempts)).toISOString()}).eq("announcement_id",a.id).eq("user_id",r.user_id);
      failed++;
    }
  }
  const{count}=await admin.from("network_announcement_recipients").select("user_id",{count:"exact",head:true}).eq("announcement_id",a.id).in("delivery_status",["pending","deferred"]);
  return{sent,deferred,failed,remaining:count||0};
}

// Someone who joins the audience later still receives what is valid. Nobody is removed: the snapshot is the record of who should have received it.
export async function reconcileLateJoiners(ctx:{admin:any},organizationId:string,now=new Date()){
  const{data:live}=await ctx.admin.from("network_announcements").select("id,audience_definition,acknowledgement_required,ack_deadline,version,expires_at").eq("organization_id",organizationId).eq("status","published").limit(200);
  const settings=await commsSettings(ctx.admin,organizationId),resolver=new AudienceResolver();let added=0;
  for(const a of live||[]){
    if(a.expires_at&&Date.parse(a.expires_at)<=now.getTime())continue;
    const definition=normalizeAudience(a.audience_definition),target=resolver.resolve(definition,await loadAudienceUniverse(ctx.admin,organizationId,definition));
    const{data:known}=await ctx.admin.from("network_announcement_recipients").select("user_id").eq("announcement_id",a.id).in("user_id",target.map(x=>x.userId)),seen=new Set((known||[]).map((x:any)=>x.user_id)),fresh=target.filter(x=>!seen.has(x.userId));
    if(!fresh.length)continue;
    const grace=new Date(now.getTime()+settings.late_joiner_ack_hours*36e5),original=a.ack_deadline?new Date(a.ack_deadline):null,due=a.acknowledgement_required?(original&&original>grace?original:grace).toISOString():null;
    await ctx.admin.from("network_announcement_recipients").upsert(fresh.map(x=>({announcement_id:a.id,organization_id:organizationId,user_id:x.userId,store_id:x.storeId,source:"late_joiner",required_version:a.version,state:"pending",delivery_status:"pending",attempt_count:0,reminder_count:0,next_attempt_at:now.toISOString(),ack_due_at:due})),{onConflict:"announcement_id,user_id",ignoreDuplicates:true});
    await enqueueDelivery(ctx.admin,{organizationId,announcementId:a.id});
    added+=fresh.length;
  }
  return added;
}

async function storeManagers(admin:any,storeId:string){
  const{data}=await admin.from("establishment_members").select("user_id").eq("establishment_id",storeId).in("role",["owner","manager"]).eq("status","active");
  return(data||[]).map((x:any)=>x.user_id) as string[];
}

// Reminders go to the person. The manager only hears a count for their own unit, never a list.
export async function scanAcknowledgements(ctx:{admin:any;notify:any},organizationId:string,now=new Date()){
  const admin=ctx.admin,nowIso=now.toISOString(),settings=await commsSettings(admin,organizationId);
  const{data:live}=await admin.from("network_announcements").select("*").eq("organization_id",organizationId).eq("status","published").eq("acknowledgement_required",true).limit(200);
  let reminded=0,escalated=0,overdueMarked=0;
  for(const a of live||[]){
    const{data:late}=await admin.from("network_announcement_recipients").update({state:"overdue"}).eq("announcement_id",a.id).in("state",["delivered","opened"]).lt("ack_due_at",nowIso).select("user_id");
    overdueMarked+=(late||[]).length;
    const{data:open}=await admin.from("network_announcement_recipients").select("*").eq("announcement_id",a.id).in("state",["delivered","opened","overdue"]).limit(1000);
    const users=(open||[]).map((x:any)=>x.user_id),{data:prefs}=users.length?await admin.from("notification_user_preferences").select("user_id,quiet_hours,timezone").eq("organization_id",organizationId).eq("category","comms").in("user_id",users):{data:[]},pref=new Map((prefs||[]).map((x:any)=>[x.user_id,x]));
    const perStore=new Map<string,number>();
    for(const r of open||[]){
      if(r.state==="overdue"&&r.store_id)perStore.set(r.store_id,(perStore.get(r.store_id)||0)+1);
      if(!reminderDue({state:r.state,ackDueAt:r.ack_due_at,reminderCount:r.reminder_count,lastReminderAt:r.last_reminder_at,hoursBefore:settings.reminder_hours_before,intervalHours:settings.reminder_interval_hours,maxReminders:settings.max_reminders,now}))continue;
      const p:any=pref.get(r.user_id);
      if(!deliveryDecision({priority:a.priority,emergency:a.emergency,bypassPolicy:settings.urgent_bypass_quiet_hours,quietHours:p?.quiet_hours,timezone:p?.timezone,now}).deliver)continue;
      try{
        await ctx.notify(admin,{organizationId,storeId:r.store_id,eventType:"comms.ack_reminder",sourceType:"network_announcement",sourceId:a.id,title:`Confirme a leitura: ${a.title}`.slice(0,180),summary:r.state==="overdue"?"O prazo de confirmação já passou.":"O prazo de confirmação está chegando.",priority:notificationPriority(a.priority),recipientUserId:r.user_id,requiresAction:true,actionDeadline:r.ack_due_at,route:feedRoute(a.id),allowedActions:["open"],metadata:{mandatory:true,version:a.version}});
        await admin.from("network_announcement_recipients").update({reminder_count:r.reminder_count+1,last_reminder_at:nowIso}).eq("announcement_id",a.id).eq("user_id",r.user_id);
        reminded++;
      }catch{/* The next scan tries again. A reminder never blocks the rest. */}
    }
    const escalatedRecently=a.last_escalated_at&&now.getTime()-Date.parse(a.last_escalated_at)<864e5;
    if(perStore.size&&!escalatedRecently){
      for(const[storeId,count]of perStore)for(const userId of await storeManagers(admin,storeId))await ctx.notify(admin,{organizationId,storeId,eventType:"comms.ack_overdue",sourceType:"network_announcement",sourceId:`${a.id}:${storeId}`,title:`Leitura pendente na sua unidade: ${a.title}`.slice(0,180),summary:`${count} confirmação(ões) em atraso nesta unidade.`,priority:"high",recipientUserId:userId,route:`/painel/operacoes/comunicacao-interna?tab=Pendências de Leitura&id=${a.id}`,allowedActions:["open","acknowledge"]}).catch(()=>null);
      await admin.from("network_announcements").update({last_escalated_at:nowIso}).eq("id",a.id);
      await emitCommsEvent(admin,{organizationId,storeId:a.store_id,event:"comms.ack_overdue",aggregateType:"network_announcement",aggregateId:a.id,dedupe:nowIso.slice(0,10),payload:{"announcement.id":a.id,"overdue.units":perStore.size}}).catch(()=>null);
      escalated++;
    }
  }
  return{reminded,escalated,overdueMarked};
}

export async function expireAnnouncements(admin:any,organizationId:string,now=new Date()){
  const{data}=await admin.from("network_announcements").update({status:"expired",updated_at:now.toISOString()}).eq("organization_id",organizationId).eq("status","published").lt("expires_at",now.toISOString()).select("id");
  for(const row of data||[]){
    await admin.from("search_documents").update({archived:true}).eq("organization_id",organizationId).eq("entity_type","announcement").eq("entity_id",row.id);
    await commsAudit(admin,{organizationId,action:"expired",resourceType:"network_announcement",resourceId:row.id});
  }
  return(data||[]).length;
}

// An emergency publication owes a review. Until someone does it, approvers keep being told.
export async function remindEmergencyReviews(ctx:{admin:any;notify:any},organizationId:string,now=new Date()){
  const{data}=await ctx.admin.from("network_announcements").select("id,title,store_id").eq("organization_id",organizationId).eq("emergency",true).is("reviewed_at",null).lt("review_due_at",now.toISOString()).limit(50);
  if(!(data||[]).length)return 0;
  const{data:org}=await ctx.admin.from("organization_members").select("user_id").eq("organization_id",organizationId).in("role",["owner","admin"]).eq("active",true);
  for(const a of data||[])for(const m of org||[])await ctx.notify(ctx.admin,{organizationId,storeId:a.store_id,eventType:"comms.emergency_review_overdue",sourceType:"network_announcement",sourceId:a.id,title:`Revisão pendente: ${a.title}`.slice(0,180),summary:"Publicação de emergência aguardando a revisão obrigatória.",priority:"high",recipientUserId:m.user_id,requiresAction:true,route:`/painel/operacoes/comunicacao-interna?tab=Crise&id=${a.id}`,allowedActions:["open"]}).catch(()=>null);
  return(data||[]).length;
}
