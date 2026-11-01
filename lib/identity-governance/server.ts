/* eslint-disable @typescript-eslint/no-explicit-any */
/* Identity Governance services. The Supabase admin client is injected so routes, workers and tests share this code. */
import {API_SCOPES} from "../integrations/types.ts";
import {SOC_PERMISSIONS} from "../security-operations/core.ts";
import {VENDOR_PERMISSIONS} from "../vendor-management/core.ts";
import {AccessBaselineService,AccessCatalogService,EffectiveAccessService,IDGOV_PERMISSIONS,IdentityClassificationService,scopeKeyOf} from "./core.ts";

const must=<T>(result:{data:T;error:any},step:string):T=>{if(result.error)throw new Error(`${step}: ${result.error.message}`);return result.data};

export async function governanceAudit(admin:any,input:{organizationId:string;actorId?:string|null;action:string;resourceType:string;resourceId?:string|null;reason?:string|null;metadata?:Record<string,unknown>}){
  const correlationId=crypto.randomUUID();
  await Promise.all([
    admin.from("identity_governance_audit_events").insert({organization_id:input.organizationId,actor_id:input.actorId||null,action:input.action,resource_type:input.resourceType,resource_id:input.resourceId||null,reason:input.reason||null,correlation_id:correlationId,safe_metadata:input.metadata||{}}),
    admin.from("security_audit_logs").insert({actor_user_id:input.actorId||null,organization_id:input.organizationId,action:`idgov.${input.action}`,target_type:input.resourceType,target_id:input.resourceId||null,after_state:input.metadata||{},correlation_id:correlationId}),
  ]);
}

export async function readEffectiveAccess(admin:any,organizationId:string,userId?:string|null){const raw=must(await admin.rpc("rbac_read_effective_access",{requested_organization_id:organizationId,requested_user_id:userId||null}),"ler acesso efetivo");return new EffectiveAccessService().compute(raw)}

export async function syncCatalog(admin:any,organizationId:string){
  const catalog=new AccessCatalogService().compose({modulePermissions:{soc:SOC_PERMISSIONS,vendor:VENDOR_PERMISSIONS,idgov:IDGOV_PERMISSIONS},apiScopes:API_SCOPES});
  const existing=must(await admin.from("access_entitlements").select("key").eq("organization_id",organizationId),"ler catálogo") as any[],known=new Set(existing.map(x=>x.key)),fresh=catalog.filter(x=>!known.has(x.key)).map(x=>({...x,organization_id:organizationId}));
  // Existing rows keep owners, status and duration edited by the organization: a re-sync only adds what is new.
  if(fresh.length)must(await admin.from("access_entitlements").insert(fresh),"gravar catálogo");
  return{total:catalog.length,created:fresh.length};
}

export async function syncIdentities(admin:any,organizationId:string){
  const service=new IdentityClassificationService(),[orgMembers,stores,clients,agents]=await Promise.all([
    admin.from("organization_members").select("user_id,role,active").eq("organization_id",organizationId),
    admin.from("establishments").select("id").eq("organization_id",organizationId),
    admin.from("api_clients").select("id,name,status,created_by,last_used_at,expires_at").eq("organization_id",organizationId),
    admin.from("ai_agents").select("id,agent_key,owner_label,lifecycle_status").eq("organization_id",organizationId),
  ]);
  const storeIds=(must(stores,"ler lojas") as any[]).map(x=>x.id),[members,staff]=storeIds.length?await Promise.all([admin.from("establishment_members").select("user_id,status").in("establishment_id",storeIds),admin.from("custom_staff_members").select("user_id,status,termination_date").in("establishment_id",storeIds).not("user_id","is",null)]):[{data:[],error:null},{data:[],error:null}];
  const people=new Map<string,any>();
  for(const m of must(orgMembers,"ler membros") as any[])people.set(m.user_id,{active:m.active});
  for(const m of must(members,"ler membros da loja") as any[])people.set(m.user_id,{active:(people.get(m.user_id)?.active)||m.status==="active"});
  for(const s of must(staff,"ler funcionários") as any[])people.set(s.user_id,{...(people.get(s.user_id)||{active:s.status==="active"}),staff:true,terminated:Boolean(s.termination_date&&Date.parse(s.termination_date)<=Date.now())});
  const rows:any[]=[];
  for(const[userId,p]of people)rows.push({organization_id:organizationId,identity_ref:userId,identity_type:service.humanType({isStaff:p.staff}),user_id:userId,lifecycle_status:p.terminated?"leaving":p.active?"active":"suspended",governance_status:service.governanceStatus({identityType:"employee",hasBaselineOnly:true}),source_system:p.staff?"custom_staff_members":"organization_members"});
  for(const c of must(clients,"ler credenciais") as any[])rows.push({organization_id:organizationId,identity_ref:c.id,identity_type:"api_client",lifecycle_status:c.status==="active"?"active":c.status==="revoked"?"terminated":"suspended",governance_status:service.governanceStatus({identityType:"api_client",ownerRef:c.created_by}),owner_ref:c.created_by,source_system:"api_clients",source_ref:c.name,valid_until:c.expires_at,last_seen_at:c.last_used_at});
  // owner_label is free text in Phase 80: it names an owner without proving one, so the agent stays partially governed.
  for(const a of must(agents,"ler agentes") as any[])rows.push({organization_id:organizationId,identity_ref:a.id,identity_type:"ai_agent",lifecycle_status:a.lifecycle_status==="retired"?"archived":"active",governance_status:a.owner_label?"partially_governed":"orphan",owner_ref:a.owner_label||null,source_system:"ai_agents",source_ref:a.agent_key});
  if(rows.length)must(await admin.from("governed_identities").upsert(rows,{onConflict:"organization_id,identity_type,identity_ref",ignoreDuplicates:false}),"gravar identidades");
  return{identities:rows.length,users:people.size,duplicatedPersonalData:false};
}

export async function importBaseline(admin:any,organizationId:string,actorId:string|null){
  const[effective,entitlements,identities,existing]=await Promise.all([readEffectiveAccess(admin,organizationId),admin.from("access_entitlements").select("id,key").eq("organization_id",organizationId),admin.from("governed_identities").select("id,user_id").eq("organization_id",organizationId),admin.from("access_grants").select("identity_id,entitlement_id,scope_key").eq("organization_id",organizationId).in("status",["pending","active","expiring"])]);
  const plan=new AccessBaselineService().plan({effective,entitlements:must(entitlements,"ler catálogo") as any[],identities:must(identities,"ler identidades") as any[],existing:must(existing,"ler concessões") as any[]});
  if(plan.grants.length)must(await admin.from("access_grants").insert(plan.grants.map(x=>({...x,organization_id:organizationId,granted_at:new Date().toISOString(),created_by:actorId}))),"gravar linha de base");
  await governanceAudit(admin,{organizationId,actorId,action:"baseline_imported",resourceType:"access_grants",metadata:{imported:plan.grants.length,unmapped:plan.unmapped.length,revocations:0}});
  return{imported:plan.grants.length,unmapped:plan.unmapped,revocations:0};
}

export {scopeKeyOf};
