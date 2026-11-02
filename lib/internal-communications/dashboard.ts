/* eslint-disable @typescript-eslint/no-explicit-any */
import {CRISIS_TYPES,reachMetrics} from "./core.ts";
import {COMMS_SETTINGS_DEFAULTS,commsSettings} from "./server.ts";
import {ensureTemplates} from "./templates.ts";
import {publicAnnouncement} from "./acknowledgements.ts";

// A person with some of the stores sees what reached those stores, what started in them and what they wrote. Never the rest of the network.
export async function visibleAnnouncements(ctx:any,limit=200){
  const columns="*";
  if(ctx.allStores){const{data}=await ctx.admin.from("network_announcements").select(columns).eq("organization_id",ctx.organizationId).order("created_at",{ascending:false}).limit(limit);return data||[]}
  const{data:reached}=await ctx.admin.from("network_announcement_recipients").select("announcement_id").eq("organization_id",ctx.organizationId).in("store_id",ctx.storeIds).limit(5000);
  const ids=[...new Set((reached||[]).map((x:any)=>x.announcement_id))] as string[];
  const parts=[`store_id.in.(${ctx.storeIds.join(",")})`,`created_by.eq.${ctx.actorId}`];
  if(ids.length)parts.push(`id.in.(${ids.slice(0,300).join(",")})`);
  const{data}=await ctx.admin.from("network_announcements").select(columns).eq("organization_id",ctx.organizationId).or(parts.join(",")).order("created_at",{ascending:false}).limit(limit);
  return data||[];
}

// What the editor offers by name. Everything is read inside this organization and within the stores this person has.
async function audienceOptions(ctx:any){
  const org=(table:string,columns="id,name")=>ctx.admin.from(table).select(columns).eq("organization_id",ctx.organizationId).limit(500);
  const[stores,brands,regions,clusters,positions,shifts,articles,courses,incidents]=await Promise.all([
    ctx.admin.from("establishments").select("id,name").eq("organization_id",ctx.organizationId).in("id",ctx.storeIds).limit(500),
    org("network_brands"),org("network_regions"),org("network_clusters"),
    ctx.admin.from("staff_roles").select("id,name,establishment_id").in("establishment_id",ctx.storeIds).limit(500),
    org("work_shift_templates","id,name,store_id").in("store_id",ctx.storeIds),
    org("knowledge_articles","id,title").eq("status","published"),org("learning_courses","id,title").eq("status","published"),
    ctx.admin.from("operational_incidents").select("id,incident_number,title").eq("organization_id",ctx.organizationId).in("store_id",ctx.storeIds).neq("visibility","confidential").not("status","in",'("closed","cancelled")').limit(100),
  ]);
  const named=(result:any)=>result.data||[],titled=(result:any)=>(result.data||[]).map((x:any)=>({id:x.id,name:x.incident_number?`${x.incident_number} · ${x.title}`:x.title}));
  return{stores:named(stores),brands:named(brands),regions:named(regions),clusters:named(clusters),positions:named(positions),shifts:named(shifts),articles:titled(articles),courses:titled(courses),incidents:titled(incidents)};
}

export async function commsDashboard(ctx:any){
  const announcements=await visibleAnnouncements(ctx),ids=announcements.map((x:any)=>x.id),options=await audienceOptions(ctx);
  await ensureTemplates(ctx.admin,ctx.organizationId);
  let reachQuery=ctx.admin.from("fact_comms_reach").select("*").eq("organization_id",ctx.organizationId);
  if(!ctx.allStores)reachQuery=reachQuery.in("store_id",ctx.storeIds);
  const[settings,{data:reach},{data:templates},{data:versions}]=await Promise.all([
    commsSettings(ctx.admin,ctx.organizationId),reachQuery.limit(5000),
    ctx.admin.from("comms_templates").select("*").eq("organization_id",ctx.organizationId).eq("status","active").order("name"),
    ids.length?ctx.admin.from("network_announcement_versions").select("announcement_id,version,title,material_change,change_note,created_at").in("announcement_id",ids.slice(0,100)).order("version",{ascending:false}):Promise.resolve({data:[]}),
  ]);
  const reachRows=reach||[],live=announcements.filter((x:any)=>x.status==="published"),byAnnouncement=new Map<string,any[]>();
  for(const row of reachRows)byAnnouncement.set(row.announcement_id,[...(byAnnouncement.get(row.announcement_id)||[]),row]);
  const withReach=(a:any)=>({...publicAnnouncement(a),reach:reachMetrics((byAnnouncement.get(a.id)||[]).map((r:any)=>({...r,acknowledgement_required:a.acknowledgement_required}))),versions:(versions||[]).filter((v:any)=>v.announcement_id===a.id)});
  const pending=live.filter((a:any)=>a.acknowledgement_required).map((a:any)=>{const rows=byAnnouncement.get(a.id)||[],sum=(k:string)=>rows.reduce((n:number,x:any)=>n+Number(x[k]||0),0);return{id:a.id,title:a.title,priority:a.priority,ack_deadline:a.ack_deadline,recipients:sum("recipients"),acknowledged:sum("acknowledged"),overdue:sum("overdue")}}).filter((x:any)=>x.acknowledged<x.recipients);
  const metrics=reachMetrics(reachRows),crisis=announcements.filter((x:any)=>CRISIS_TYPES.includes(x.announcement_type));
  return{
    cards:{active:live.length,mandatoryWithPending:pending.length,acknowledgementRate:metrics.acknowledgementRate,scheduled:announcements.filter((x:any)=>x.status==="scheduled").length,activeCrises:crisis.filter((x:any)=>x.status==="published").length,awaitingApproval:announcements.filter((x:any)=>x.status==="pending_approval"||x.pending_edit_approval_id).length,emergencyReviewsDue:announcements.filter((x:any)=>x.emergency&&!x.reviewed_at).length},
    options,metrics,announcements:announcements.map(withReach),pending,crisis:crisis.map(withReach),templates:templates||[],settings:{...COMMS_SETTINGS_DEFAULTS,...settings},permissions:ctx.permissions,flags:ctx.flags,storeIds:ctx.storeIds,allStores:ctx.allStores,
    privacy:{individualMetrics:false,namedListOnlyFor:"comunicado obrigatório, com permissão e nas suas unidades"},
  };
}

// For the module's own scan. Everything else reads announcements through the functions above.
export async function organizationsWithComms(admin:any){
  const[{data:stores},{data:planned}]=await Promise.all([admin.from("store_feature_flags").select("establishments(organization_id)").eq("internal_communications_enabled",true).limit(5000),admin.from("subscriptions").select("establishments(organization_id),plans!inner(internal_communications_enabled)").eq("plans.internal_communications_enabled",true).in("status",["active","trialing","past_due"]).limit(5000)]);
  return[...new Set([...(stores||[]),...(planned||[])].map((x:any)=>x.establishments?.organization_id).filter(Boolean))] as string[];
}
