/* eslint-disable @typescript-eslint/no-explicit-any */
/* Who an announcement is for. Everything is read inside one organization, so a definition cannot reach another tenant even with a forged id. */
import {readAll} from "./server.ts";

export const AUDIENCE_SCOPES=["organization","brand","region","cluster","franchise","store","team"] as const;
export type AudienceDefinition={scope:{type:typeof AUDIENCE_SCOPES[number];ids:string[]};filters:{roles:string[];positions:string[];shifts:string[];languages:string[]}};
export const DEFAULT_LANGUAGE="pt-BR";
const list=(value:unknown)=>Array.isArray(value)?[...new Set(value.map(String).filter(Boolean))].slice(0,200):[];

export function normalizeAudience(value:any):AudienceDefinition{
  const type=value?.scope?.type;
  if(!AUDIENCE_SCOPES.includes(type))throw new Error("AUDIENCE_SCOPE_INVALID");
  const ids=list(value?.scope?.ids);
  if(!["organization","franchise"].includes(type)&&!ids.length)throw new Error("AUDIENCE_TARGET_REQUIRED");
  return{scope:{type,ids},filters:{roles:list(value?.filters?.roles),positions:list(value?.filters?.positions),shifts:list(value?.filters?.shifts),languages:list(value?.filters?.languages)}};
}

export type AudienceUniverse={
  stores:Array<{id:string;network_brand_id?:string|null;network_region_id?:string|null;ownership_type?:string|null}>;
  clusterStores?:Array<{cluster_id:string;store_id:string}>;
  storeMembers:Array<{user_id:string;establishment_id:string;role:string}>;
  orgMembers:Array<{user_id:string;role:string;all_stores:boolean}>;
  storeAccess?:Array<{user_id:string;establishment_id:string}>;
  staff?:Array<{id:string;user_id:string|null;establishment_id:string;primary_store_id?:string|null;role_id:string}>;
  assignments?:Array<{employee_id:string;store_id:string}>;
  shifts?:Array<{employee_id:string;store_id:string;template_id:string|null}>;
  staffRoles?:Array<{id:string;establishment_id:string}>;
  languages?:Record<string,string|null>;
};

export class AudienceResolver{
  targetStores(definition:AudienceDefinition,universe:AudienceUniverse):string[]{
    const{type,ids}=definition.scope,wanted=new Set(ids),stores=universe.stores;
    if(type==="organization")return stores.map(x=>x.id);
    if(type==="store")return stores.filter(x=>wanted.has(x.id)).map(x=>x.id);
    if(type==="brand")return stores.filter(x=>wanted.has(String(x.network_brand_id))).map(x=>x.id);
    if(type==="region")return stores.filter(x=>wanted.has(String(x.network_region_id))).map(x=>x.id);
    if(type==="franchise")return stores.filter(x=>x.ownership_type==="franchise"&&(!ids.length||wanted.has(x.id))).map(x=>x.id);
    if(type==="cluster"){const inCluster=new Set((universe.clusterStores||[]).filter(x=>wanted.has(x.cluster_id)).map(x=>x.store_id));return stores.filter(x=>inCluster.has(x.id)).map(x=>x.id)}
    // A team is a position (staff_roles) inside a store. Its id must belong to a store of this organization.
    const known=new Set(stores.map(x=>x.id));
    return[...new Set((universe.staffRoles||[]).filter(x=>wanted.has(x.id)&&known.has(x.establishment_id)).map(x=>x.establishment_id))];
  }

  resolve(definition:AudienceDefinition,universe:AudienceUniverse):Array<{userId:string;storeId:string|null}>{
    const{type,ids}=definition.scope,{roles,positions,shifts,languages}=definition.filters,targets=new Set(this.targetStores(definition,universe)),network=!["store","team"].includes(type);
    const people=new Map<string,{stores:string[];roles:Set<string>;positions:Set<string>;shifts:Set<string>;direct:boolean}>();
    const person=(id:string)=>{let p=people.get(id);if(!p){p={stores:[],roles:new Set(),positions:new Set(),shifts:new Set(),direct:false};people.set(id,p)}return p};
    for(const m of universe.storeMembers)if(targets.has(m.establishment_id)){const p=person(m.user_id);p.stores.push(m.establishment_id);p.roles.add(m.role);p.direct=true}
    for(const a of universe.storeAccess||[])if(targets.has(a.establishment_id)){const p=person(a.user_id);p.stores.push(a.establishment_id);p.direct=true}
    const assigned=new Map<string,string[]>();for(const a of universe.assignments||[])assigned.set(a.employee_id,[...(assigned.get(a.employee_id)||[]),a.store_id]);
    const shiftsByEmployee=new Map<string,typeof universe.shifts>();for(const s of universe.shifts||[])shiftsByEmployee.set(s.employee_id,[...(shiftsByEmployee.get(s.employee_id)||[]),s]);
    for(const s of universe.staff||[]){
      if(!s.user_id)continue;
      const works=[s.primary_store_id,s.establishment_id,...(assigned.get(s.id)||[])].filter(Boolean) as string[],here=works.filter(x=>targets.has(x));
      if(!here.length)continue;
      const p=person(s.user_id);p.stores.push(...here);p.positions.add(s.role_id);p.direct=true;
      for(const shift of shiftsByEmployee.get(s.id)||[])if(shift.template_id&&targets.has(shift.store_id))p.shifts.add(shift.template_id);
    }
    // Whole-network roles hear network announcements. A single store's notice stays with the people of that store.
    if(network&&targets.size)for(const m of universe.orgMembers)if(m.all_stores||["owner","admin"].includes(m.role))person(m.user_id).roles.add(m.role);
    const teamPositions=type==="team"?new Set(ids):null,out:Array<{userId:string;storeId:string|null}>=[];
    for(const[userId,p]of people){
      if(teamPositions&&![...p.positions].some(x=>teamPositions.has(x)))continue;
      if(roles.length&&!roles.some(x=>p.roles.has(x)))continue;
      if(positions.length&&!positions.some(x=>p.positions.has(x)))continue;
      if(shifts.length&&!shifts.some(x=>p.shifts.has(x)))continue;
      if(languages.length&&!languages.includes(universe.languages?.[userId]||DEFAULT_LANGUAGE))continue;
      out.push({userId,storeId:p.stores[0]||null});
    }
    return out;
  }
}

export async function loadAudienceUniverse(admin:any,organizationId:string,definition:AudienceDefinition):Promise<AudienceUniverse>{
  const{data:stores,error}=await admin.from("establishments").select("id,network_brand_id,network_region_id,ownership_type").eq("organization_id",organizationId);
  if(error)throw new Error(error.message);
  const ids=(stores||[]).map((x:any)=>x.id);
  if(!ids.length)return{stores:[],storeMembers:[],orgMembers:[]};
  const today=new Date().toISOString().slice(0,10),day=864e5,from=new Date(Date.now()-14*day).toISOString().slice(0,10),to=new Date(Date.now()+14*day).toISOString().slice(0,10);
  const[storeMembers,orgMembers,storeAccess,staff,assignments,clusterStores,staffRoles]=await Promise.all([
    readAll(()=>admin.from("establishment_members").select("user_id,establishment_id,role").in("establishment_id",ids).eq("status","active").order("user_id")),
    readAll(()=>admin.from("organization_members").select("user_id,role,all_stores").eq("organization_id",organizationId).eq("active",true).order("user_id")),
    readAll(()=>admin.from("organization_member_store_access").select("user_id,establishment_id").eq("organization_id",organizationId).order("user_id")),
    readAll(()=>admin.from("custom_staff_members").select("id,user_id,establishment_id,primary_store_id,role_id").in("establishment_id",ids).eq("status","active").is("archived_at",null).not("user_id","is",null).order("id")),
    readAll(()=>admin.from("employee_store_assignments").select("employee_id,store_id,ends_on").eq("organization_id",organizationId).or(`ends_on.is.null,ends_on.gte.${today}`).order("id")),
    definition.scope.type==="cluster"?readAll(()=>admin.from("network_cluster_stores").select("cluster_id,store_id").in("store_id",ids).order("store_id")):Promise.resolve([]),
    definition.scope.type==="team"?readAll(()=>admin.from("staff_roles").select("id,establishment_id").in("establishment_id",ids).order("id")):Promise.resolve([]),
  ]);
  const shifts=definition.filters.shifts.length?await readAll(()=>admin.from("work_shifts").select("employee_id,store_id,template_id").eq("organization_id",organizationId).eq("publication_status","published").neq("status","cancelled").gte("shift_date",from).lte("shift_date",to).order("id")):[];
  const languages:Record<string,string|null>={};
  if(definition.filters.languages.length){
    const users=[...new Set([...storeMembers,...orgMembers,...staff].map((x:any)=>x.user_id).filter(Boolean))] as string[];
    for(let i=0;i<users.length;i+=200){const{data}=await admin.from("profiles").select("id,preferred_language").in("id",users.slice(i,i+200));for(const row of data||[])languages[row.id]=row.preferred_language}
  }
  return{stores:stores||[],storeMembers,orgMembers,storeAccess,staff,assignments,clusterStores,staffRoles,shifts,languages} as AudienceUniverse;
}
