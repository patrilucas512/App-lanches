/* eslint-disable @typescript-eslint/no-explicit-any */
/* ROPA and legal bases. The system records what the tenant's legal team decided; it never picks a basis on its own. */
import {DATA_CATEGORIES,LEGAL_BASIS_KEYS,SUBJECT_CATEGORIES,dpiaRequired,mustData,ropaIssues} from "./core.ts";
import {privacyAudit,privacySettings} from "./server.ts";

const BASIS_LABELS:Record<string,string>={consent:"Consentimento",contract:"Execução de contrato",legal_obligation:"Cumprimento de obrigação legal",legitimate_interest:"Legítimo interesse",exercise_of_rights:"Exercício regular de direitos",credit_protection:"Proteção do crédito",health_protection:"Tutela da saúde",other:"Outra (descrever)"};
export async function ensureLegalBases(admin:any,contextId:string){
  const{data}=await admin.from("privacy_legal_bases").select("basis_key").eq("context_id",contextId);
  const have=new Set((data||[]).map((x:any)=>x.basis_key)),missing=LEGAL_BASIS_KEYS.filter(k=>!have.has(k));
  if(missing.length)await admin.from("privacy_legal_bases").upsert(missing.map(k=>({context_id:contextId,basis_key:k,label:BASIS_LABELS[k],requires_assessment:k==="legitimate_interest"})),{onConflict:"context_id,basis_key",ignoreDuplicates:true});
}

const pick=(list:unknown,allowed:readonly string[])=>(Array.isArray(list)?list:[]).map(String).filter(x=>allowed.includes(x));
// Every save becomes a new version with the full snapshot, so the ROPA of a past date can be rebuilt.
export async function saveActivity(ctx:any,input:any){
  if(ctx.actorType&&ctx.actorType!=="user")throw new Error("HUMAN_DECISION_REQUIRED");
  const settings=await privacySettings(ctx.admin,ctx.contextId);
  const row:any={name:String(input.name||"").trim().slice(0,160),purpose:String(input.purpose||"").trim(),legal_basis_key:LEGAL_BASIS_KEYS.includes(input.legal_basis_key)?input.legal_basis_key:null,lia_reference:input.lia_reference||null,
    data_categories:pick(input.data_categories,DATA_CATEGORIES),subject_categories:pick(input.subject_categories,SUBJECT_CATEGORIES),systems:(Array.isArray(input.systems)?input.systems:[]).map(String).slice(0,30),
    sharing:Array.isArray(input.sharing)?input.sharing.slice(0,30):[],subprocessor_vendor_ids:(Array.isArray(input.subprocessor_vendor_ids)?input.subprocessor_vendor_ids:[]).map(String),
    international_transfer:input.international_transfer===true,transfer_mechanism:input.transfer_mechanism||null,retention_summary:input.retention_summary||null,security_measures:input.security_measures||null,
    owner_user_id:input.owner_user_id||ctx.actorId,uses_ai:input.uses_ai===true,profiling:input.profiling===true,location_monitoring:input.location_monitoring===true,updated_by:ctx.actorId,updated_at:new Date().toISOString()};
  if(row.name.length<3)throw new Error("NAME_REQUIRED");
  const issues=ropaIssues(row,settings);
  const status=input.status==="active"?"active":input.status==="retired"?"retired":"draft";
  // An activity only goes active complete: purpose, basis (with LIA when required), retention and an owner.
  if(status==="active"&&issues.length)throw new Error(issues.join(","));
  let saved:any;
  if(input.id){const current=mustData(await ctx.admin.from("processing_activities").select("*").eq("id",input.id).eq("context_id",ctx.contextId).single(),"atividade");saved=mustData(await ctx.admin.from("processing_activities").update({...row,status,version:current.version+1}).eq("id",current.id).select().single(),"atividade")}
  else saved=mustData(await ctx.admin.from("processing_activities").insert({...row,status,context_id:ctx.contextId,created_by:ctx.actorId}).select().single(),"atividade");
  await ctx.admin.from("processing_activity_versions").insert({activity_id:saved.id,context_id:ctx.contextId,version:saved.version,snapshot:saved,change_note:input.change_note||null,edited_by:ctx.actorId});
  const dpia=dpiaRequired({...saved,shares_with_third_parties:(saved.sharing||[]).length>0||(saved.subprocessor_vendor_ids||[]).length>0},settings.dpia_triggers);
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:input.id?"ropa_updated":"ropa_created",resourceType:"processing_activity",resourceId:saved.id,metadata:{version:saved.version,status,legal_basis:saved.legal_basis_key,dpia_required:dpia.required}});
  return{activity:saved,issues,dpia};
}

// Exportable ROPA: one row per activity, readable by the DPO and by an auditor.
export async function exportRopa(ctx:any){
  const{data,error}=await ctx.admin.from("processing_activities").select("name,purpose,legal_basis_key,lia_reference,data_categories,subject_categories,systems,sharing,international_transfer,transfer_mechanism,retention_summary,security_measures,status,version,updated_at").eq("context_id",ctx.contextId).neq("status","retired").order("name");
  if(error)throw new Error(error.message);
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:"ropa_exported",resourceType:"processing_activity",metadata:{rows:(data||[]).length}});
  return{generatedAt:new Date().toISOString(),activities:(data||[]).map((x:any)=>({...x,legal_basis_label:BASIS_LABELS[x.legal_basis_key]||null}))};
}
