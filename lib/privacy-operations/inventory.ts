/* eslint-disable @typescript-eslint/no-explicit-any */
/* The personal data map, built on the Phase 76 catalog instead of beside it. */
import {DATA_CATEGORIES,SUBJECT_CATEGORIES,detectPersonalColumns,mustData,unmappedPersonalColumns} from "./core.ts";
import {privacyAudit} from "./server.ts";

// Product rows (no context) plus the context's own rows. A context row for the same column wins.
export async function dataMap(ctx:any){
  const{data,error}=await ctx.admin.from("personal_data_map").select("*").or(`context_id.is.null,context_id.eq.${ctx.contextId}`).eq("status","active").order("domain").limit(2000);
  if(error)throw new Error(error.message);
  const byKey=new Map<string,any>();
  for(const row of data||[]){const key=`${row.table_name}.${row.column_name}`;if(!byKey.has(key)||row.context_id)byKey.set(key,row)}
  return[...byKey.values()];
}

export async function saveMapEntry(ctx:any,input:any){
  if(!(DATA_CATEGORIES as readonly string[]).includes(input.data_category))throw new Error("CATEGORY_INVALID");
  if(!(SUBJECT_CATEGORIES as readonly string[]).includes(input.subject_category))throw new Error("SUBJECT_CATEGORY_INVALID");
  const row={context_id:ctx.contextId,domain:String(input.domain||"").slice(0,60),table_name:String(input.table_name||"").slice(0,80),column_name:String(input.column_name||"").slice(0,80),data_category:input.data_category,subject_category:input.subject_category,sensitive:input.sensitive===true||input.data_category==="health_allergy",owner_service:String(input.owner_service||"").slice(0,120)||"A definir",adapter_key:input.adapter_key||null,legal_retention:input.legal_retention||null,notes:input.notes||null,updated_at:new Date().toISOString()};
  if(!/^[a-z_][a-z0-9_]*$/.test(row.table_name)||!/^[a-z_][a-z0-9_]*$/.test(row.column_name)||!row.domain)throw new Error("MAP_ENTRY_INVALID");
  const{data:existing}=await ctx.admin.from("personal_data_map").select("id").eq("context_id",ctx.contextId).eq("table_name",row.table_name).eq("column_name",row.column_name).maybeSingle();
  const saved=mustData(existing?await ctx.admin.from("personal_data_map").update(row).eq("id",existing.id).select().single():await ctx.admin.from("personal_data_map").insert(row).select().single(),"mapa");
  await ctx.admin.from("privacy_inventory_findings").update({status:"mapped",resolved_by:ctx.actorId,resolved_at:new Date().toISOString()}).eq("context_id",ctx.contextId).eq("table_name",row.table_name).eq("column_name",row.column_name).eq("status","open");
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:"data_map_saved",resourceType:"personal_data_map",resourceId:saved.id,metadata:{table:row.table_name,column:row.column_name,category:row.data_category}});
  return saved;
}

/* Two-way link with Data Governance: fields the tenant catalogued that look personal and are not mapped become findings;
   fields that are mapped get their catalog sensitivity set to personal_data, so the catalog and the map agree. */
export async function syncWithDataGovernance(ctx:any){
  const[map,{data:assets}]=await Promise.all([dataMap(ctx),ctx.admin.from("data_assets").select("id,system_name").eq("organization_id",ctx.organizationId).limit(2000)]);
  const assetName=new Map((assets||[]).map((a:any)=>[a.id,String(a.system_name).replace(/^public\./,"")]));
  const ids=[...assetName.keys()];if(!ids.length)return{findings:0,linked:0};
  const{data:fields}=await ctx.admin.from("data_asset_fields").select("id,asset_id,field_name,sensitivity").in("asset_id",ids.slice(0,1000)).eq("status","active").limit(10000);
  const catalogued=(fields||[]).map((f:any)=>({id:f.id,table:assetName.get(f.asset_id) as string,column:f.field_name,sensitivity:f.sensitivity}));
  const personal=catalogued.filter((f:any)=>detectPersonalColumns(`alter table ${f.table} add column ${f.column} text;`).length);
  const unmapped=unmappedPersonalColumns(personal,map);
  let findings=0,linked=0;
  for(const f of unmapped){const{error}=await ctx.admin.from("privacy_inventory_findings").insert({context_id:ctx.contextId,table_name:f.table,column_name:f.column,source:"data_governance"});if(!error)findings++}
  const mapped=new Map(map.map((m:any)=>[`${m.table_name}.${m.column_name}`,m]));
  for(const f of catalogued){const entry:any=mapped.get(`${f.table}.${f.column}`);if(!entry)continue;
    if(f.sensitivity!=="personal_data"){await ctx.admin.from("data_asset_fields").update({sensitivity:"personal_data",updated_at:new Date().toISOString()}).eq("id",f.id);linked++}
    if(entry.context_id===ctx.contextId&&entry.data_asset_field_id!==f.id)await ctx.admin.from("personal_data_map").update({data_asset_field_id:f.id}).eq("id",entry.id)}
  return{findings,linked};
}

export async function resolveFinding(ctx:any,input:{id:string;reason:string}){
  if(String(input.reason||"").trim().length<5)throw new Error("REASON_REQUIRED");
  mustData(await ctx.admin.from("privacy_inventory_findings").update({status:"dismissed",resolution_reason:input.reason,resolved_by:ctx.actorId,resolved_at:new Date().toISOString()}).eq("id",input.id).eq("context_id",ctx.contextId).eq("status","open").select("id").single(),"achado");
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:"finding_dismissed",resourceType:"privacy_inventory_finding",resourceId:input.id,reason:input.reason});
  return{ok:true};
}
