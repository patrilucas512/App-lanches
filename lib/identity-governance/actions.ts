/* eslint-disable @typescript-eslint/no-explicit-any */
/* High-impact actions are previewed and confirmed on the ActionEngine ledger. The Copilot never sees the token, so it cannot run them. */
import {createHash,randomUUID} from "node:crypto";

export const IDGOV_ACTION_TYPES=["IDGOV_GRANT_CRITICAL","IDGOV_REVOKE_CRITICAL","IDGOV_DISABLE_IDENTITY","IDGOV_BULK_REVOKE","IDGOV_ACTIVATE_BREAK_GLASS","IDGOV_CHANGE_PRIVILEGED_BUNDLE"] as const;
const digest=(value:string)=>createHash("sha256").update(value).digest("hex");
const RISK:Record<string,string>={low:"LOW",medium:"MEDIUM",high:"HIGH",critical:"CRITICAL"};

export async function openGovernedAction(ctx:{admin:any;organizationId:string;storeId:string;actorId:string},input:{actionType:typeof IDGOV_ACTION_TYPES[number];criticality:string;targetType:string;targetIds?:string[];payload:Record<string,unknown>;preview:Record<string,unknown>;idempotencyKey:string;before?:Record<string,unknown>}){
  const token=randomUUID();
  const{data,error}=await ctx.admin.from("copilot_action_requests").insert({organization_id:ctx.organizationId,establishment_id:ctx.storeId,requested_by:ctx.actorId,action_type:input.actionType,risk_level:RISK[input.criticality]||"HIGH",status:"pending_confirmation",target_type:input.targetType,target_ids:input.targetIds||[],normalized_payload:input.payload,preview:input.preview,before_state:input.before||{},confirmation_token_hash:digest(token),confirmation_expires_at:new Date(Date.now()+15*60000).toISOString(),required_approvals:1,idempotency_key:input.idempotencyKey,source:"identity_governance"}).select("id,preview,confirmation_expires_at").single();
  if(error)throw new Error(error.message);
  return{action_id:data.id,confirmation_token:token,preview:data.preview,expires_at:data.confirmation_expires_at};
}

// Only the person who saw the preview can confirm it, once and before it expires.
export async function claimGovernedAction(ctx:{admin:any;organizationId:string;actorId:string},input:{actionId:string;token:string}){
  const{data:row}=await ctx.admin.from("copilot_action_requests").select("*").eq("id",input.actionId).eq("organization_id",ctx.organizationId).eq("source","identity_governance").maybeSingle();
  if(!row)throw new Error("ACTION_NOT_FOUND");
  if(row.requested_by!==ctx.actorId)throw new Error("ACTION_CONFIRMATION_FORBIDDEN");
  if(row.status!=="pending_confirmation")throw new Error("ACTION_ALREADY_HANDLED");
  if(Date.parse(row.confirmation_expires_at)<=Date.now()){await ctx.admin.from("copilot_action_requests").update({status:"expired"}).eq("id",row.id);throw new Error("ACTION_EXPIRED")}
  if(row.confirmation_token_hash!==digest(input.token))throw new Error("ACTION_TOKEN_INVALID");
  const{data:claimed}=await ctx.admin.from("copilot_action_requests").update({confirmed_at:new Date().toISOString(),status:"pending_approval"}).eq("id",row.id).eq("status","pending_confirmation").select("id").maybeSingle();
  if(!claimed)throw new Error("ACTION_ALREADY_HANDLED");
  return row;
}
export async function closeGovernedAction(admin:any,actionId:string,result:{ok:boolean;detail?:unknown;reason?:string}){await admin.from("copilot_action_requests").update({status:result.ok?"executed":"failed",executed_at:result.ok?new Date().toISOString():null,result:result.detail||{},failure_reason:result.ok?null:(result.reason||"FAILED")}).eq("id",actionId)}
