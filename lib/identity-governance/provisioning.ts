/* eslint-disable @typescript-eslint/no-explicit-any */
/* The only way this module changes real access. It calls the rbac_* facade, then reads the source back before reporting success. */
import {EffectiveAccessService,type TechnicalRef} from "./core.ts";

export type ProvisioningInput={organizationId:string;userId:string;technicalRef:TechnicalRef;entitlementKey:string;scope:{establishment_id?:string};scopeKey:string};
export type ProvisioningResult={ok:boolean;state:"provisioned"|"already_present"|"revoked"|"already_absent"|"restored"|"failed";reason?:string;previousRole?:string|null;verified:boolean};

const effective=async(admin:any,input:ProvisioningInput)=>{const{data,error}=await admin.rpc("rbac_read_effective_access",{requested_organization_id:input.organizationId,requested_user_id:input.userId});if(error)throw new Error(error.message);return new EffectiveAccessService().compute(data)};
const present=async(admin:any,input:ProvisioningInput,key=input.entitlementKey)=>new EffectiveAccessService().has(await effective(admin,input),input.userId,key,input.scopeKey);
const call=async(admin:any,name:string,args:Record<string,unknown>)=>{const{data,error}=await admin.rpc(name,args);if(error)throw new Error(error.message);return data};

export class AccessProvisioningService{
  admin:any;
  constructor(admin:any){this.admin=admin}
  async grant(input:ProvisioningInput):Promise<ProvisioningResult>{
    const ref=input.technicalRef;
    if(ref.adapter==="read_only")return{ok:false,state:"failed",reason:"NO_OFFICIAL_PATH",verified:false};
    try{
      if(await present(this.admin,input))return{ok:true,state:"already_present",verified:true};
      let previousRole:string|null=null;
      if(ref.adapter==="establishment_role"){if(!input.scope.establishment_id)return{ok:false,state:"failed",reason:"SCOPE_REQUIRED",verified:false};previousRole=(await call(this.admin,"rbac_apply_establishment_role",{requested_organization_id:input.organizationId,requested_establishment_id:input.scope.establishment_id,requested_user_id:input.userId,requested_role:ref.role}))?.previous_role??null}
      else if(ref.adapter==="organization_role")previousRole=(await call(this.admin,"rbac_apply_organization_role",{requested_organization_id:input.organizationId,requested_user_id:input.userId,requested_role:ref.role,requested_all_stores:false}))?.previous_role??null;
      else await call(this.admin,"rbac_set_module_permission",{requested_organization_id:input.organizationId,requested_user_id:input.userId,requested_module:ref.module,requested_permission_key:ref.permission_key,requested_active:true});
      const verified=await present(this.admin,input);
      return verified?{ok:true,state:"provisioned",previousRole,verified:true}:{ok:false,state:"failed",reason:"GRANT_NOT_VERIFIED",previousRole,verified:false};
    }catch(error:any){return{ok:false,state:"failed",reason:error.message,verified:false}}
  }
  // A role that replaced another one is restored rather than removed, so an elevation never strips the person's base access.
  async revoke(input:ProvisioningInput&{previousRole?:string|null}):Promise<ProvisioningResult>{
    const ref=input.technicalRef;
    if(ref.adapter==="read_only")return{ok:false,state:"failed",reason:"NO_OFFICIAL_PATH",verified:false};
    try{
      if(!await present(this.admin,input))return{ok:true,state:"already_absent",verified:true};
      if(ref.adapter==="establishment_role"){
        if(!input.scope.establishment_id)return{ok:false,state:"failed",reason:"SCOPE_REQUIRED",verified:false};
        if(input.previousRole)await call(this.admin,"rbac_apply_establishment_role",{requested_organization_id:input.organizationId,requested_establishment_id:input.scope.establishment_id,requested_user_id:input.userId,requested_role:input.previousRole});
        else await call(this.admin,"rbac_revoke_establishment_role",{requested_organization_id:input.organizationId,requested_establishment_id:input.scope.establishment_id,requested_user_id:input.userId,requested_role:ref.role});
      }else if(ref.adapter==="organization_role"){
        if(input.previousRole)await call(this.admin,"rbac_apply_organization_role",{requested_organization_id:input.organizationId,requested_user_id:input.userId,requested_role:input.previousRole,requested_all_stores:false});
        else await call(this.admin,"rbac_revoke_organization_role",{requested_organization_id:input.organizationId,requested_user_id:input.userId,requested_role:ref.role});
      }else await call(this.admin,"rbac_set_module_permission",{requested_organization_id:input.organizationId,requested_user_id:input.userId,requested_module:ref.module,requested_permission_key:ref.permission_key,requested_active:false});
      const still=await present(this.admin,input);
      return still?{ok:false,state:"failed",reason:"REVOCATION_NOT_CONFIRMED",verified:false}:{ok:true,state:input.previousRole?"restored":"revoked",verified:true};
    }catch(error:any){return{ok:false,state:"failed",reason:error.message,verified:false}}
  }
}
