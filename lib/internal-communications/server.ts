/* eslint-disable @typescript-eslint/no-explicit-any */
/* What every service needs: audit, settings, flags and events. */
export const COMMS_SETTINGS_DEFAULTS={emergency_publish_allowed:false,urgent_bypass_quiet_hours:false,self_approval_allowed:false,required_approvals:1,reminder_hours_before:24,reminder_interval_hours:24,max_reminders:3,late_joiner_ack_hours:72,emergency_review_hours:24,board_comments_enabled:false,poll_minimum_responses:5,retention_months:null as number|null};

export async function commsAudit(admin:any,input:{organizationId:string;storeId?:string|null;actorId?:string|null;action:string;resourceType:string;resourceId?:string|null;reason?:string|null;metadata?:Record<string,unknown>}){
  await Promise.all([
    admin.from("comms_audit_events").insert({organization_id:input.organizationId,store_id:input.storeId||null,actor_id:input.actorId||null,actor_type:input.actorId?"user":"system",action:input.action,resource_type:input.resourceType,resource_id:input.resourceId||null,reason:input.reason||null,metadata:input.metadata||{}}),
    admin.from("security_audit_logs").insert({actor_user_id:input.actorId||null,organization_id:input.organizationId,action:`comms.${input.action}`,target_type:input.resourceType,target_id:input.resourceId||null,metadata:input.metadata||{}}),
  ]);
}

export async function commsSettings(admin:any,organizationId:string){
  const{data}=await admin.from("comms_settings").select("*").eq("organization_id",organizationId).maybeSingle();
  return{...COMMS_SETTINGS_DEFAULTS,...(data||{})};
}

export async function commsStoreFlags(admin:any,storeId:string,flags:readonly string[]){
  const[{data:row},{data:subscription}]=await Promise.all([admin.from("store_feature_flags").select(flags.join(",")).eq("establishment_id",storeId).maybeSingle(),admin.from("subscriptions").select(`plans(${flags.join(",")})`).eq("establishment_id",storeId).in("status",["active","trialing","past_due"]).order("created_at",{ascending:false}).limit(1).maybeSingle()]);
  const plan=(subscription as any)?.plans;
  return Object.fromEntries(flags.map(flag=>[flag,(row as any)?.[flag]===true||plan?.[flag]===true])) as Record<string,boolean>;
}

// Event ids are deterministic, so a retried job never fires the same automation twice.
export async function emitCommsEvent(admin:any,input:{organizationId:string;storeId?:string|null;event:string;aggregateType:string;aggregateId:string;dedupe?:string;payload?:Record<string,unknown>}){
  const id=`${input.event}:${input.aggregateId}${input.dedupe?`:${input.dedupe}`:""}`;
  const{error}=await admin.from("automation_event_inbox").upsert({id,organization_id:input.organizationId,store_id:input.storeId||null,event_name:input.event,schema_version:1,aggregate_type:input.aggregateType,aggregate_id:input.aggregateId,payload:input.payload||{},correlation_id:id},{onConflict:"id",ignoreDuplicates:true});
  if(error)throw new Error(`evento ${input.event}: ${error.message}`);
}

// Reads every page. A silent 1000-row cap would quietly drop people from a mandatory announcement.
export async function readAll<T=any>(build:()=>any,pageSize=1000,maxRows=100000):Promise<T[]>{
  const out:T[]=[];
  for(let from=0;from<maxRows;from+=pageSize){
    const{data,error}=await build().range(from,from+pageSize-1);
    if(error)throw new Error(error.message);
    out.push(...(data||[]));
    if((data||[]).length<pageSize)return out;
  }
  throw new Error("AUDIENCE_TOO_LARGE");
}
