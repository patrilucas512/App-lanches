/* eslint-disable @typescript-eslint/no-explicit-any */
/* Access reviews: a "revoke" decision runs the official revocation and is only certified once confirmed. */
import {createHash} from "node:crypto";
import {revokeGrant,type GovernanceContext} from "./requests.ts";
import {AccessReviewService} from "./rules.ts";
import {governanceAudit} from "./server.ts";

// Phase 25 keeps a shorter list of review types; each campaign maps to the closest one.
const RUN_TYPES:Record<string,string>={manager_review:"roles",entitlement_owner_review:"roles",privileged_review:"admins",service_account_review:"api_keys",vendor_review:"integrations",dormant_access_review:"full",sod_review:"full"};

export async function createReviewCampaign(ctx:GovernanceContext,input:{name:string;reviewType:string;dueAt?:string;filters?:{privilegedOnly?:boolean;identityIds?:string[];identityTypes?:string[];baselineOnly?:boolean};reviewerId?:string|null}){
  const{data:settings}=await ctx.admin.from("identity_governance_settings").select("review_due_days").eq("organization_id",ctx.organizationId).maybeSingle(),dueAt=input.dueAt||new Date(Date.now()+(settings?.review_due_days||30)*864e5).toISOString(),filters=input.filters||{},{data:run}=await ctx.admin.from("access_review_runs").insert({organization_id:ctx.organizationId,review_type:RUN_TYPES[input.reviewType]||"full",status:"open",due_at:dueAt,created_by:ctx.actorId,summary:{source:"identity_governance"}}).select("id").maybeSingle();
  const{data:campaign,error}=await ctx.admin.from("access_review_campaigns").insert({organization_id:ctx.organizationId,name:input.name,review_type:input.reviewType,status:"active",due_at:dueAt,filters,review_run_id:run?.id||null,created_by:ctx.actorId}).select().single();
  if(error)throw new Error(error.message);
  let query=ctx.admin.from("access_grants").select("id,identity_id,entitlement_id,source_type,valid_until,scope_key,reason,approved_by,granted_at,governed_identities(user_id,identity_type,last_seen_at),access_entitlements(key,name,criticality,privileged,owner_ref)").eq("organization_id",ctx.organizationId).in("status",["active","expiring"]);
  if(filters.identityIds?.length)query=query.in("identity_id",filters.identityIds);
  const{data:grants}=await query,selected=(grants||[]).filter((g:any)=>(!filters.privilegedOnly&&input.reviewType!=="privileged_review"||g.access_entitlements?.privileged)&&(!filters.identityTypes?.length||filters.identityTypes.includes(g.governed_identities?.identity_type))&&(!filters.baselineOnly||g.source_type==="migration_baseline"));
  const{data:conflicts}=await ctx.admin.from("sod_conflicts").select("identity_id,severity,status").eq("organization_id",ctx.organizationId).eq("status","open");
  // The review context holds what a decision needs: origin, approval, use, criticality and conflicts. No personal data.
  const items=new AccessReviewService().assign({items:selected.map((g:any)=>({grant_id:g.id,identity_user_id:g.governed_identities?.user_id,owner_ref:g.access_entitlements?.owner_ref,identity_id:g.identity_id,entitlement_id:g.entitlement_id,critical:g.access_entitlements?.criticality==="critical",context:{origin:g.source_type,reason:g.reason,approved_by_count:(g.approved_by||[]).length,granted_at:g.granted_at,valid_until:g.valid_until,scope:g.scope_key,entitlement:g.access_entitlements?.name,criticality:g.access_entitlements?.criticality,privileged:g.access_entitlements?.privileged,last_seen_at:g.governed_identities?.last_seen_at,open_sod_conflicts:(conflicts||[]).filter((c:any)=>c.identity_id===g.identity_id).length}})),defaultReviewer:input.reviewerId||ctx.actorId}).map((x:any)=>({grant_id:x.grant_id,identity_id:x.identity_id,entitlement_id:x.entitlement_id,critical:x.critical,context:x.context,reviewer_id:x.reviewer_id,organization_id:ctx.organizationId,campaign_id:campaign.id}));
  if(items.length){const{error:itemsError}=await ctx.admin.from("access_review_items").insert(items);if(itemsError)throw new Error(itemsError.message)}
  await governanceAudit(ctx.admin,{organizationId:ctx.organizationId,actorId:ctx.actorId,action:"review_campaign_created",resourceType:"access_review_campaign",resourceId:campaign.id,metadata:{review_type:input.reviewType,items:items.length,unassigned:items.filter((x:any)=>!x.reviewer_id).length}});
  return{campaign,items:items.length,unassigned:items.filter((x:any)=>!x.reviewer_id).length};
}

export async function decideReviewItem(ctx:GovernanceContext,input:{itemId:string;decision:string;reason:string;delegateTo?:string|null;canManage?:boolean}){
  const service=new AccessReviewService(),{data:item}=await ctx.admin.from("access_review_items").select("*,governed_identities(user_id)").eq("id",input.itemId).eq("organization_id",ctx.organizationId).maybeSingle();
  if(!item)throw new Error("REVIEW_ITEM_NOT_FOUND");
  // A revocation that failed can be decided again; otherwise the campaign could never be certified.
  if(item.decision&&!["delegate","needs_info"].includes(item.decision)&&item.execution_status!=="failed")throw new Error("REVIEW_ITEM_ALREADY_DECIDED");
  const check=service.canDecide({actorId:ctx.actorId as string,identityUserId:item.governed_identities?.user_id,reviewerId:item.reviewer_id,canManage:input.canManage});
  if(!check.allowed)throw new Error(check.reasons.join(","));
  if(input.reason.trim().length<3)throw new Error("REASON_REQUIRED");
  const now=new Date().toISOString(),base:any={decision:input.decision,reason:input.reason,decided_by:ctx.actorId,decided_at:now,execution_status:"not_required"};
  if(input.decision==="delegate"){if(!input.delegateTo)throw new Error("DELEGATE_REQUIRED");base.reviewer_id=input.delegateTo;base.execution_status="pending"}
  if(input.decision==="needs_info")base.execution_status="pending";
  if(["revoke","reduce_scope","change_duration"].includes(input.decision)){
    // Reducing scope or duration replaces the grant, so it starts by revoking; the new access then follows a normal request.
    const result=item.grant_id?await revokeGrant(ctx,{grantId:item.grant_id,reason:`Revisão de acesso: ${input.reason}`}):{ok:false,reason:"GRANT_NOT_FOUND"};
    base.execution_status=result.ok?"revoked":"failed";base.execution_detail=result.ok?null:result.reason;
  }
  const{data,error}=await ctx.admin.from("access_review_items").update(base).eq("id",item.id).select().single();
  if(error)throw new Error(error.message);
  await governanceAudit(ctx.admin,{organizationId:ctx.organizationId,actorId:ctx.actorId,action:"review_decided",resourceType:"access_review_item",resourceId:item.id,reason:input.reason,metadata:{decision:input.decision,execution:base.execution_status}});
  return data;
}

export async function bulkDecideReview(ctx:GovernanceContext,input:{itemIds:string[];decision:string;reason:string;confirmed:boolean;canManage?:boolean}){
  const{data:items}=await ctx.admin.from("access_review_items").select("id,critical").eq("organization_id",ctx.organizationId).in("id",input.itemIds);
  new AccessReviewService().bulk({items:items||[],decision:input.decision,confirmed:input.confirmed});
  const results:any[]=[];
  for(const item of items||[])try{results.push({id:item.id,ok:true,row:await decideReviewItem(ctx,{itemId:item.id,decision:input.decision,reason:input.reason,canManage:input.canManage})})}catch(error:any){results.push({id:item.id,ok:false,reason:error.message})}
  await governanceAudit(ctx.admin,{organizationId:ctx.organizationId,actorId:ctx.actorId,action:"review_bulk_decided",resourceType:"access_review_item",reason:input.reason,metadata:{decision:input.decision,total:results.length,failed:results.filter(x=>!x.ok).length}});
  return{results};
}

export async function certifyCampaign(ctx:GovernanceContext,input:{campaignId:string}){
  const{data:campaign}=await ctx.admin.from("access_review_campaigns").select("*").eq("id",input.campaignId).eq("organization_id",ctx.organizationId).maybeSingle();
  if(!campaign)throw new Error("CAMPAIGN_NOT_FOUND");
  const{data:items}=await ctx.admin.from("access_review_items").select("id,decision,decided_by,decided_at,execution_status").eq("campaign_id",campaign.id);
  const summary=new AccessReviewService().certification({campaignId:campaign.id,items:items||[]}),evidence=createHash("sha256").update(JSON.stringify(summary)).digest("hex"),now=new Date().toISOString(),{data,error}=await ctx.admin.from("access_certifications").insert({organization_id:ctx.organizationId,campaign_id:campaign.id,certified_by:ctx.actorId,summary,evidence_hash:evidence}).select().single();
  if(error)throw new Error(error.message);
  await ctx.admin.from("access_review_campaigns").update({status:"completed",completed_at:now}).eq("id",campaign.id);
  if(campaign.review_run_id)await ctx.admin.from("access_review_runs").update({status:"completed",completed_at:now,summary:{total:summary.total,kept:summary.kept,revoked:summary.revoked,evidence_hash:evidence}}).eq("id",campaign.review_run_id);
  await governanceAudit(ctx.admin,{organizationId:ctx.organizationId,actorId:ctx.actorId,action:"review_certified",resourceType:"access_certification",resourceId:data.id,metadata:{total:summary.total,revoked:summary.revoked,evidence_hash:evidence}});
  return data;
}
