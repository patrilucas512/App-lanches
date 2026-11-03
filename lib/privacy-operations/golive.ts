/* eslint-disable @typescript-eslint/no-explicit-any */
/* Go-live checklist per store. The module is configured with privacy_setup_enabled; privacy_operations_enabled (the one that
   reaches customers) is only switched on through here, and the database refuses it otherwise. */
import {mustData} from "./core.ts";
import {privacyAudit,privacySettings} from "./server.ts";

export type ChecklistItem={key:string;label:string;critical:boolean;ok:boolean;detail:string};

// Pure: the decision to let a store go live. An override exists only for the DPO and is always recorded with a reason.
export function goLiveGate(items:ChecklistItem[],input:{override?:boolean;reason?:string|null;isDpo:boolean}){
  const pending=items.filter(i=>i.critical&&!i.ok).map(i=>i.key);
  if(!pending.length)return{allowed:true,pending,override:false};
  if(!input.override)return{allowed:false,pending,override:false,reason:"GO_LIVE_BLOCKED"};
  if(!input.isDpo)return{allowed:false,pending,override:false,reason:"FORBIDDEN"};
  if(String(input.reason||"").trim().length<20)return{allowed:false,pending,override:false,reason:"REASON_REQUIRED"};
  return{allowed:true,pending,override:true};
}

export async function goLiveChecklist(ctx:any):Promise<ChecklistItem[]>{
  const yearAgo=new Date(Date.now()-365*864e5).toISOString();
  const[settings,{data:context},{data:purposes},{data:texts},{data:dpoGrant},{data:connection},{data:processors},{data:policies},{data:accessTest}]=await Promise.all([
    privacySettings(ctx.admin,ctx.contextId),
    ctx.admin.from("privacy_contexts").select("dpo_user_id,dpo_contact").eq("id",ctx.contextId).maybeSingle(),
    ctx.admin.from("consent_purposes").select("id,current_version,label").eq("context_id",ctx.contextId).eq("active",true),
    ctx.admin.from("consent_text_versions").select("purpose_id,version,legal_review_status").eq("context_id",ctx.contextId),
    ctx.admin.from("privacy_member_permissions").select("user_id").eq("organization_id",ctx.organizationId).eq("permission_key","privacy:dpo").eq("active",true),
    ctx.admin.from("whatsapp_connections").select("id").eq("establishment_id",ctx.storeId).eq("status","connected").limit(1).maybeSingle(),
    ctx.admin.from("vendor_privacy_profiles").select("id,last_reviewed_at,status").or(`context_id.eq.${ctx.contextId},context_id.is.null`).eq("status","active"),
    ctx.admin.from("retention_policies").select("id,status").eq("context_id",ctx.contextId).eq("status","active"),
    ctx.admin.from("customer_privacy_requests").select("id").eq("context_id",ctx.contextId).eq("request_type","access").eq("status","fulfilled").limit(1).maybeSingle(),
  ]);
  const reviewed=(p:any)=>(texts||[]).some((t:any)=>t.purpose_id===p.id&&t.version===p.current_version&&t.legal_review_status==="reviewed");
  const unreviewed=(purposes||[]).filter((p:any)=>!reviewed(p)),dpoIds=(dpoGrant||[]).map((x:any)=>x.user_id);
  const staleProcessors=(processors||[]).filter((p:any)=>!p.last_reviewed_at||p.last_reviewed_at<yearAgo);
  return[
    {key:"consent_texts",label:"Textos de consentimento redigidos e aprovados",critical:true,ok:(purposes||[]).length>0&&!unreviewed.length,detail:unreviewed.length?`Faltam: ${unreviewed.map((p:any)=>p.label).join(", ")}`:"Todos revisados."},
    {key:"deadlines",label:"Prazos validados pelo encarregado",critical:true,ok:settings.legal_review_status==="reviewed",detail:settings.legal_review_status==="reviewed"?"Revisão registrada.":"Registre a revisão em Configurações."},
    {key:"dpo",label:"Encarregado nomeado, com a permissão privacy:dpo",critical:true,ok:Boolean(context?.dpo_user_id)&&dpoIds.includes(context.dpo_user_id),detail:!context?.dpo_user_id?"Nenhum encarregado nomeado.":dpoIds.includes(context.dpo_user_id)?"Nomeado e com permissão.":"O encarregado nomeado não tem privacy:dpo (concessão pela Governança de Acessos)."},
    {key:"verification_channel",label:"Canal para enviar o código de verificação",critical:true,ok:Boolean(connection),detail:connection?"WhatsApp conectado.":"Conecte o WhatsApp da loja; sem ele, toda verificação é manual."},
    {key:"subprocessors",label:"Suboperadores revisados no último ano",critical:false,ok:(processors||[]).length>0&&!staleProcessors.length,detail:!(processors||[]).length?"Nenhum suboperador registrado.":staleProcessors.length?`${staleProcessors.length} sem revisão recente.`:"Em dia."},
    {key:"retention_policies",label:"Políticas de retenção aprovadas",critical:false,ok:(policies||[]).length>0,detail:(policies||[]).length?`${policies.length} ativa(s).`:"Nenhuma política ativa."},
    {key:"access_test",label:"Teste de solicitação de acesso feito",critical:true,ok:Boolean(accessTest),detail:accessTest?"Feito.":"Faça um pedido de acesso de teste até o fim (com um titular fictício)."},
  ];
}

export async function enableStore(ctx:any,input:{override?:boolean;reason?:string|null}){
  if(ctx.actorType&&ctx.actorType!=="user")throw new Error("HUMAN_DECISION_REQUIRED");
  const items=await goLiveChecklist(ctx),gate=goLiveGate(items,{override:input.override,reason:input.reason,isDpo:ctx.permissions?.includes("privacy:dpo")});
  if(!gate.allowed)throw new Error(gate.reason||"GO_LIVE_BLOCKED");
  const record=mustData(await ctx.admin.from("privacy_go_live_records").insert({context_id:ctx.contextId,store_id:ctx.storeId,checklist:items,critical_pending:gate.pending,override:gate.override,override_reason:gate.override?input.reason:null,decided_by:ctx.actorId}).select().single(),"go-live");
  // The database trigger checks this record before it accepts the flag; another path to the flag is refused.
  const{error}=await ctx.admin.from("store_feature_flags").update({privacy_operations_enabled:true}).eq("establishment_id",ctx.storeId);
  if(error)throw new Error(error.message.includes("PRIVACY_GO_LIVE_REQUIRED")?"PRIVACY_GO_LIVE_REQUIRED":`flag: ${error.message}`);
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:gate.override?"go_live_override":"go_live_enabled",resourceType:"store",resourceId:ctx.storeId,reason:input.reason||null,metadata:{record_id:record.id,pending:gate.pending}});
  return{enabled:true,override:gate.override,pending:gate.pending};
}

// Turning the module off never needs the checklist. The consent gate goes back to the legacy rules at once.
export async function disableStore(ctx:any,input:{reason:string}){
  if(String(input.reason||"").trim().length<10)throw new Error("REASON_REQUIRED");
  const{error}=await ctx.admin.from("store_feature_flags").update({privacy_operations_enabled:false,privacy_dsr_portal_enabled:false}).eq("establishment_id",ctx.storeId);
  if(error)throw new Error(error.message);
  await privacyAudit(ctx.admin,{organizationId:ctx.organizationId,contextId:ctx.contextId,actorId:ctx.actorId,action:"go_live_disabled",resourceType:"store",resourceId:ctx.storeId,reason:input.reason});
  return{enabled:false};
}
