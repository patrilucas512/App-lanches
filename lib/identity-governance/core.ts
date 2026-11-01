/* eslint-disable @typescript-eslint/no-explicit-any */
/* Identity Governance: pure, explainable domain rules. Auth/RBAC stays the source of truth; nothing here grants access. */
export const IDGOV_PERMISSIONS=["idgov:view","idgov:view_sensitive","idgov:request_access","idgov:approve_access","idgov:manage_catalog","idgov:manage_sod","idgov:manage_reviews","idgov:review_access","idgov:activate_break_glass","idgov:review_break_glass","idgov:manage_service_accounts","idgov:run_reconciliation","idgov:manage_governance"] as const;
export const IDENTITY_TYPES=["employee","contractor","vendor_user","support_agent","platform_admin","service_account","api_client","integration_identity","ai_agent","shared_account"] as const;
export const NON_HUMAN_TYPES=["service_account","api_client","integration_identity","ai_agent"] as const;
export const EXTERNAL_TYPES=["contractor","vendor_user"] as const;
export const LIFECYCLE_STATUS=["pending","active","suspended","leaving","terminated","archived"] as const;
export const GOVERNANCE_STATUS=["governed","partially_governed","ungoverned","orphan"] as const;
export const ENTITLEMENT_TYPES=["role","permission_bundle","scope_grant","store_access","environment_access","data_access","feature_admin","integration_access","support_access","api_scope"] as const;
export const CRITICALITY=["low","medium","high","critical"] as const;
export const GRANT_SOURCE_TYPES=["request","birthright_role","lifecycle_rule","jit","break_glass","migration_baseline","manual_admin_legacy"] as const;
export const GRANT_STATUS=["pending","active","expiring","expired","revoked","failed"] as const;
export const FINDING_TYPES=["excessive_privilege","permanent_privileged_access","sod_conflict","orphan_account","dormant_access","ownerless_service_account","expired_vendor_access","shared_account","access_drift","unreviewed_break_glass"] as const;

export type Criticality=typeof CRITICALITY[number];
export type TechnicalRef={adapter:"establishment_role";role:string}|{adapter:"organization_role";role:string}|{adapter:"module_permission";module:"soc"|"vendor"|"idgov";permission_key:string}|{adapter:"read_only";source:string};
export type Entitlement={id?:string;key:string;name:string;description:string;entitlement_type:string;source_system:string;technical_ref:TechnicalRef;criticality:Criticality;privileged:boolean;requestable:boolean;max_duration:string|null;requires_justification:boolean;status:string;owner_ref?:string|null;technical_owner_ref?:string|null};
export type EffectiveEntry={userId:string;entitlementKey:string;scopeKey:string;scope:Record<string,string>};

const STORE_ROLES:Array<[string,Criticality,boolean,string|null]>=[["owner","critical",true,null],["manager","high",true,"7 days"],["attendant","low",false,null],["catalog_editor","medium",false,null],["kitchen","low",false,null]];
const ORG_ROLES:Array<[string,Criticality,boolean,string|null]>=[["owner","critical",true,null],["admin","critical",true,"24 hours"],["supervisor","high",true,"7 days"],["analyst","medium",false,null],["member","low",false,null]];
// Adjustments follow what the key does, not who holds it, and are always editable in the catalog.
const permissionCriticality=(key:string):[Criticality,boolean]=>/manage_governance|approve_critical|execute_emergency|manage_critical/.test(key)?["critical",true]:/execute_response|manage_|approve_|activate_break_glass|review_break_glass|run_reconciliation|view_sensitive|view_platform|request_response/.test(key)?["high",true]:/create|edit|disposition|acknowledge|run_hunts|review_/.test(key)?["medium",false]:["low",false];
// No official write path exists for these modules, so they are inventoried read-only and marked privileged.
export const SENSITIVE_MODULES=[["finance","Finance"],["policy_engine","Policy Engine"],["feature_management","Feature Management"],["change_management","Change Management"],["enterprise_risk","Risk"],["audit","Audit"],["data_governance","Data Governance"],["ai_governance","AI Governance"],["production_data","Dados de produção"],["sensitive_export","Exportação de dados sensíveis"]] as const;

export class AccessCatalogService{
  compose(input:{modulePermissions:Record<"soc"|"vendor"|"idgov",readonly string[]>;apiScopes:readonly string[]}):Entitlement[]{
    const out:Entitlement[]=[];
    for(const[role,criticality,privileged,duration]of STORE_ROLES)out.push({key:`store_role:${role}`,name:`Loja: ${role}`,description:"Papel real em establishment_members.",entitlement_type:"role",source_system:"establishment_members",technical_ref:role==="owner"?{adapter:"read_only",source:"establishment_members.owner"}:{adapter:"establishment_role",role},criticality,privileged,requestable:false,max_duration:duration,requires_justification:true,status:criticality==="critical"?"draft":"active"});
    for(const[role,criticality,privileged,duration]of ORG_ROLES)out.push({key:`org_role:${role}`,name:`Organização: ${role}`,description:"Papel real em organization_members.",entitlement_type:"role",source_system:"organization_members",technical_ref:role==="owner"?{adapter:"read_only",source:"organization_members.owner"}:{adapter:"organization_role",role},criticality,privileged,requestable:false,max_duration:duration,requires_justification:true,status:criticality==="critical"?"draft":"active"});
    for(const moduleKey of["soc","vendor","idgov"] as const)for(const key of input.modulePermissions[moduleKey]){const[criticality,privileged]=permissionCriticality(key);out.push({key:`perm:${key}`,name:key,description:`Permissão real do módulo ${moduleKey}.`,entitlement_type:"permission_bundle",source_system:`${moduleKey}_member_permissions`,technical_ref:{adapter:"module_permission",module:moduleKey,permission_key:key},criticality,privileged,requestable:false,max_duration:privileged?"24 hours":null,requires_justification:true,status:criticality==="critical"?"draft":"active"})}
    for(const scope of input.apiScopes)out.push({key:`api_scope:${scope}`,name:`API: ${scope}`,description:"Escopo real de api_clients.scopes.",entitlement_type:"api_scope",source_system:"api_clients",technical_ref:{adapter:"read_only",source:"api_clients.scopes"},criticality:/write|manage|finance/.test(scope)?"high":"medium",privileged:/manage|finance/.test(scope),requestable:false,max_duration:null,requires_justification:true,status:"active"});
    for(const[key,name]of SENSITIVE_MODULES)out.push({key:`module:${key}`,name,description:"Módulo sensível; concessão continua na tela de origem até existir caminho oficial.",entitlement_type:key==="production_data"?"environment_access":key==="sensitive_export"?"data_access":"feature_admin",source_system:"module_permissions",technical_ref:{adapter:"read_only",source:key},criticality:"critical",privileged:true,requestable:false,max_duration:"4 hours",requires_justification:true,status:"draft"});
    return out;
  }
}

export const scopeKeyOf=(scope:{establishment_id?:string|null})=>scope.establishment_id?`store:${scope.establishment_id}`:"org";

export class EffectiveAccessService{
  // Reads the RBAC facade output; organization owners/admins also inherit module rights in code, reported apart as `derived`.
  compute(raw:any):EffectiveEntry[]{
    const out:EffectiveEntry[]=[];
    for(const m of raw?.organization_members||[])if(m.active)out.push({userId:m.user_id,entitlementKey:`org_role:${m.role}`,scopeKey:"org",scope:{}});
    for(const m of raw?.establishment_members||[])out.push({userId:m.user_id,entitlementKey:`store_role:${m.role}`,scopeKey:`store:${m.establishment_id}`,scope:{establishment_id:m.establishment_id}});
    for(const p of raw?.module_permissions||[])out.push({userId:p.user_id,entitlementKey:`perm:${p.permission_key}`,scopeKey:"org",scope:{}});
    return out;
  }
  has(entries:EffectiveEntry[],userId:string,entitlementKey:string,scopeKey:string){return entries.some(x=>x.userId===userId&&x.entitlementKey===entitlementKey&&x.scopeKey===scopeKey)}
}

export class IdentityClassificationService{
  // A person is an employee when a staff record says so; otherwise only the membership is known, which stays partially governed.
  humanType(input:{isStaff?:boolean;isVendor?:boolean;shared?:boolean}){return input.shared?"shared_account":input.isVendor?"vendor_user":"employee"}
  governanceStatus(input:{identityType:string;ownerRef?:string|null;sponsorRef?:string|null;lifecycleStatus?:string;hasBaselineOnly?:boolean}){
    if(NON_HUMAN_TYPES.includes(input.identityType as never)&&!input.ownerRef)return"orphan";
    if(EXTERNAL_TYPES.includes(input.identityType as never)&&!input.sponsorRef)return"orphan";
    if(input.identityType==="shared_account")return"ungoverned";
    return input.hasBaselineOnly?"partially_governed":"governed";
  }
}

export class AccessBaselineService{
  // Imports what already exists, marked for review. Revoking anything here would break the promise of a safe first run.
  plan(input:{effective:EffectiveEntry[];entitlements:Array<{id:string;key:string}>;identities:Array<{id:string;user_id:string|null}>;existing:Array<{identity_id:string;entitlement_id:string;scope_key:string}>}){
    const entitlement=new Map(input.entitlements.map(x=>[x.key,x.id])),identity=new Map(input.identities.filter(x=>x.user_id).map(x=>[x.user_id as string,x.id])),seen=new Set(input.existing.map(x=>`${x.identity_id}|${x.entitlement_id}|${x.scope_key}`)),grants:any[]=[],unmapped:string[]=[];
    for(const e of input.effective){const entitlementId=entitlement.get(e.entitlementKey),identityId=identity.get(e.userId);if(!entitlementId||!identityId){unmapped.push(`${e.entitlementKey}@${e.scopeKey}`);continue}const key=`${identityId}|${entitlementId}|${e.scopeKey}`;if(seen.has(key))continue;seen.add(key);grants.push({identity_id:identityId,entitlement_id:entitlementId,scope:e.scope,scope_key:e.scopeKey,source_type:"migration_baseline",reason:"Acesso existente importado na linha de base da Fase 93.",status:"active",review_required:true})}
    return{grants,unmapped,revocations:0};
  }
}

export class IdentityGovernanceAccessService{
  // Holding a governance permission never includes the target access: this only answers what the actor may do in this module.
  resolve(input:{orgRole?:string|null;storeRole?:string|null;explicit?:string[]}){const permissions=new Set<string>(input.explicit||[]);if(input.orgRole==="owner"||input.orgRole==="admin")IDGOV_PERMISSIONS.forEach(x=>permissions.add(x));else if(input.storeRole==="owner")["idgov:view","idgov:request_access","idgov:review_access"].forEach(x=>permissions.add(x));return{permissions:[...permissions],grantsTargetAccess:false}}
  check(input:{organizationId?:string|null;resourceOrganizationId?:string|null;permissions:string[];required:string}){const tenant=Boolean(input.organizationId&&input.organizationId===input.resourceOrganizationId);return{allowed:tenant&&input.permissions.includes(input.required),tenantIsolated:tenant,grantsTargetAccess:false}}
  // Sensitive fields of other tenants are never loaded; inside the tenant they need idgov:view_sensitive.
  mask<T extends Record<string,unknown>>(row:T,permissions:string[],fields:string[]=["evidence","safe_metadata","owner_ref","sponsor_ref"]){if(permissions.includes("idgov:view_sensitive"))return row;return Object.fromEntries(Object.entries(row).map(([k,v])=>[k,fields.includes(k)&&v!=null?"[restrito]":v])) as T}
}

export class AccessPriorityService{
  // Explainable order, never a score of a person. Personal behaviour and sensitive attributes are not inputs.
  prioritize(input:{criticality?:Criticality;privileged?:boolean;scope?:string;ageDays?:number;evidence?:string;temporary?:boolean}){
    const reasons:string[]=[`criticidade:${input.criticality||"low"}`];let rank={low:1,medium:2,high:3,critical:4}[input.criticality||"low"];
    if(input.privileged){rank++;reasons.push("privilegiado")}if(input.scope==="org"){rank++;reasons.push("escopo:organização")}if((input.ageDays||0)>30){rank++;reasons.push("aberto_há_mais_de_30_dias")}if(input.temporary===false&&input.privileged){rank++;reasons.push("sem_validade")}if(input.evidence)reasons.push(`evidência:${input.evidence}`);
    return{severity:(rank>=5?"critical":rank>=4?"high":rank>=2?"medium":"low") as Criticality,reasons,opaqueScore:false,rankedPeople:false};
  }
  order<T extends{severity:string;first_seen_at?:string;scope_key?:string}>(rows:T[]){const weight:Record<string,number>={critical:4,high:3,medium:2,low:1};return[...rows].sort((a,b)=>weight[b.severity]-weight[a.severity]||(a.scope_key==="org"?-1:0)-(b.scope_key==="org"?-1:0)||Date.parse(a.first_seen_at||"0")-Date.parse(b.first_seen_at||"0"))}
}
