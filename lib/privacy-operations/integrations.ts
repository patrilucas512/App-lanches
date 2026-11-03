/* eslint-disable @typescript-eslint/no-explicit-any */
/* Contracts with the rest of the product. Data only here, so Reporting, Workspace, Data Platform and Identity can import it. */
import {PRIVACY_AI_FORBIDDEN} from "./core.ts";

const DIMENSIONS=["date"];
const metric=(key:string,label:string,unit:string,aggregation:string,additive:boolean,dimensions=DIMENSIONS)=>({key,label,unit,aggregation,additive,dimensions});
export const PRIVACY_REPORT_METRICS={
  privacy_dsr_on_time_rate:metric("privacy_dsr_on_time_rate","DSR On-Time Rate","percent","ratio",false,["date","request_type"]),
  privacy_dsr_median_resolution_hours:metric("privacy_dsr_median_resolution_hours","Median DSR Resolution Time","hours","semantic",false,["date","request_type"]),
  privacy_consent_revocation_rate:metric("privacy_consent_revocation_rate","Consent Revocation Rate","percent","ratio",false,["date","purpose"]),
  privacy_unmapped_field_count:metric("privacy_unmapped_field_count","Unmapped Personal Field Count","count","count",true,[]),
  privacy_overdue_retention_count:metric("privacy_overdue_retention_count","Overdue Retention Count","count","count",true,[]),
  privacy_open_incident_count:metric("privacy_open_incident_count","Open Privacy Incident Count","count","count",true,[]),
} as const;
export const PRIVACY_METRIC_DENOMINATORS={privacy_dsr_on_time_rate:"solicitações concluídas com prazo",privacy_dsr_median_resolution_hours:"solicitações concluídas",privacy_consent_revocation_rate:"registros de consentimento",privacy_unmapped_field_count:"sem denominador; é uma contagem",privacy_overdue_retention_count:"sem denominador; é uma contagem",privacy_open_incident_count:"sem denominador; é uma contagem"} as const;
const dataset=(id:string,name:string,description:string,metrics:string[],dimensions=DIMENSIONS)=>({id,name,description,source:"warehouse",metrics,dimensions,filters:dimensions,timeGranularity:["day","week","month"],permissions:["reports:view","privacy:view"],sensitivity:"restricted",realtime:false,maxDays:731});
export const PRIVACY_DATASET_DEFINITIONS={
  processing_activities:dataset("processing_activities","Atividades de tratamento (ROPA)","Atividades registradas, com finalidade, base legal e retenção.",[]),
  consent_records:dataset("consent_records","Consentimentos por finalidade","Concessões e revogações por finalidade e canal, sem titulares.",["privacy_consent_revocation_rate"],["date","purpose"]),
  data_subject_requests:dataset("data_subject_requests","Solicitações de titulares","Solicitações por tipo, canal, status e prazo, sem titulares.",["privacy_dsr_on_time_rate","privacy_dsr_median_resolution_hours"],["date","request_type"]),
  retention_runs:dataset("retention_runs","Execuções de retenção","Simulações e execuções com vencidos, bloqueados e processados.",["privacy_overdue_retention_count"]),
  legal_holds:dataset("legal_holds","Bloqueios legais","Bloqueios por motivo e status.",[]),
  privacy_incidents:dataset("privacy_incidents","Incidentes de privacidade","Incidentes com avaliação e decisão de comunicação.",["privacy_open_incident_count"]),
  privacy_impact_assessments:dataset("privacy_impact_assessments","RIPD","Relatórios de impacto por status.",[]),
  subprocessors:dataset("subprocessors","Suboperadores","Fornecedores que recebem dados pessoais.",[]),
} as const;
export const PRIVACY_REPORT_DATASETS=Object.keys(PRIVACY_DATASET_DEFINITIONS) as Array<keyof typeof PRIVACY_DATASET_DEFINITIONS>;
export const PRIVACY_REPORT_TEMPLATES=["ROPA exportável","Solicitações por tipo e prazo","Consentimentos por finalidade","Execuções de retenção","Suboperadores","Incidentes de privacidade","Status de RIPD"] as const;
export const PRIVACY_FACTS=["fact_privacy_requests"] as const;
export const PRIVACY_WIDGETS=["privacy_dsr_due"] as const;
export const PRIVACY_AUTOMATION_TRIGGERS=["privacy.dsr_received"] as const;
export const PRIVACY_SAFE_AUTOMATION_ACTIONS=["privacy_remind_dsr_deadline"] as const;
export const PRIVACY_FORBIDDEN_ACTIONS=PRIVACY_AI_FORBIDDEN;
export const PRIVACY_PLAN_ENTITLEMENTS={
  basico:["privacy_operations_enabled"],
  profissional:["privacy_operations_enabled","privacy_dsr_portal_enabled"],
  premium:["privacy_operations_enabled","privacy_dsr_portal_enabled","privacy_retention_execution_enabled","privacy_auto_anonymization_enabled"],
  enterprise:["privacy_operations_enabled","privacy_dsr_portal_enabled","privacy_retention_execution_enabled","privacy_auto_anonymization_enabled","privacy_ai_assistance_enabled"],
} as const;
export const PRIVACY_COPILOT_TOOLS=["getPrivacyOverview","findSubjectData","getConsentStatus","getOpenDataSubjectRequests","previewDeletion","getRetentionStatus","getProcessingActivity","draftDsrResponse"] as const;

// Read-only and built from what the module already returned for this person. It gets no client to write with: it cannot
// delete, define a legal basis, answer a subject or decide on telling the ANPD.
export function privacyCopilot(tool:string,data:any,input:any={}){
  if(!(PRIVACY_COPILOT_TOOLS as readonly string[]).includes(tool))throw new Error("TOOL_NOT_ALLOWED");
  const base={tool,canExecuteDeletion:false,canDefineLegalBasis:false,canRespondToSubject:false,canDecideIncidentNotification:false,notice:"O assistente só consulta e prepara rascunhos. Excluir, definir base legal, responder ao titular e decidir comunicação de incidente continuam com pessoas."};
  const cards=data?.cards||{};
  if(tool==="getPrivacyOverview")return{...base,answer:`${cards.openRequests??0} solicitação(ões) aberta(s), ${cards.requestsDueSoon??0} perto do prazo, ${cards.unmappedFields??0} campo(s) pessoal(is) sem mapeamento e ${cards.openIncidents??0} incidente(s) de privacidade aberto(s).`};
  if(tool==="getOpenDataSubjectRequests"){const list=(data?.requests||[]).filter((r:any)=>!["fulfilled","partially_fulfilled","rejected_with_reason","closed"].includes(r.status));return{...base,answer:`${list.length} solicitação(ões) aberta(s).`,items:list.slice(0,10).map((r:any)=>`${r.request_type} · ${r.status} · prazo ${r.due_at?String(r.due_at).slice(0,10):"não configurado"}`)}}
  if(tool==="getRetentionStatus"){const runs=data?.retention?.runs||[];return{...base,answer:`${(data?.retention?.policies||[]).filter((p:any)=>p.status==="active").length} política(s) ativa(s); última simulação com ${runs[0]?.due_count??0} registro(s) vencido(s).`}}
  if(tool==="getProcessingActivity"){const a=(data?.activities||[]).find((x:any)=>x.id===input.id)||(data?.activities||[])[0];return{...base,answer:a?`${a.name}: finalidade "${a.purpose}", base legal ${a.legal_basis_key||"não definida"}, retenção ${a.retention_summary||"não definida"}.`:"Nenhuma atividade registrada."}}
  if(tool==="getConsentStatus"){const list=input.consents||[];return{...base,answer:list.length?list.map((c:any)=>`${c.purpose_key} (${c.channel}): ${c.status}`).join("; "):"Nenhum consentimento registrado para este titular."}}
  if(tool==="findSubjectData"||tool==="previewDeletion"){const d=input.preview?.domains||[];return{...base,answer:d.length?d.map((x:any)=>`${x.domain}: apagar ${x.delete}, anonimizar ${x.anonymize}, manter ${x.retain}, manual ${x.manual}`).join("; "):"Abra a solicitação e gere a prévia para ver onde estão os dados."}}
  const r=input.request||{};
  return{...base,draft:true,requiresApproval:true,answer:`Olá. Recebemos sua solicitação (${r.request_type||"tipo"}) em ${String(r.received_at||"").slice(0,10)||"[data]"}. [Descrever o que foi feito e, se algo foi mantido, o motivo legal.] Qualquer dúvida, fale com nosso encarregado de dados.\n[Rascunho do assistente: só é enviado depois de aprovado por uma pessoa.]`};
}

// Report rows come from aggregates without subject columns, so a report cannot become a list of people.
export async function privacyReportRows(c:any,definition:any,period:{from:string;to:string},limit:number){
  const{data:context}=await c.a.from("privacy_contexts").select("id").eq("organization_id",c.organizationId).eq("kind","tenant_controller").maybeSingle();
  if(!context)return{rows:[],freshness:{source:"privacy_contexts",status:"empty",metric_catalog:true}};
  const from=`${period.from}T00:00:00Z`,to=`${period.to}T23:59:59Z`,ratio=(a:number,b:number)=>b?Math.round(a/b*1000)/10:null;
  if(definition.datasetId==="data_subject_requests"){const{data,error}=await c.a.from("fact_privacy_requests").select("*").eq("context_id",context.id).gte("metric_date",period.from).lte("metric_date",period.to).limit(limit);if(error)throw error;
    return{rows:(data||[]).map((x:any)=>({date:x.metric_date,request_type:x.request_type,channel:x.channel,status:x.status,requests:x.requests,overdue:x.overdue,privacy_dsr_on_time_rate:ratio(x.completed_on_time,x.completed_with_due)})),freshness:{source:"fact_privacy_requests",status:"current",metric_catalog:true}}}
  if(definition.datasetId==="consent_records"){const{data,error}=await c.a.from("consent_records").select("purpose_key,channel,status,recorded_at").eq("context_id",context.id).gte("recorded_at",from).lte("recorded_at",to).limit(20000);if(error)throw error;
    const groups=new Map<string,any>();for(const x of data||[]){const key=`${String(x.recorded_at).slice(0,10)}|${x.purpose_key}|${x.channel}`,g=groups.get(key)||{date:String(x.recorded_at).slice(0,10),purpose:x.purpose_key,channel:x.channel,granted:0,revoked:0,total:0};g.total++;if(x.status==="granted")g.granted++;if(x.status==="revoked")g.revoked++;groups.set(key,g)}
    return{rows:[...groups.values()].slice(0,limit).map(g=>({...g,privacy_consent_revocation_rate:ratio(g.revoked,g.total)})),freshness:{source:"consent_records",status:"current",metric_catalog:true}}}
  const TABLE:Record<string,[string,string]>={processing_activities:["processing_activities","name,status,legal_basis_key,version,updated_at"],retention_runs:["retention_runs","mode,status,due_count,held_count,processed_count,failed_count,created_at"],legal_holds:["legal_holds","scope_type,domain,reason,status,valid_until,created_at"],privacy_incidents:["privacy_incident_assessments","status,risk_level,involves_personal_data,anpd_decision,subjects_decision,detected_at"],privacy_impact_assessments:["privacy_impact_assessments","title,status,residual_risk,version,next_review_at"],subprocessors:["vendor_privacy_profiles","purpose,data_categories,international_transfer,last_reviewed_at,status"]};
  const[table,columns]=TABLE[definition.datasetId]||[];if(!table)throw new Error("DATASET_NOT_FOUND");
  const{data,error}=await c.a.from(table).select(columns).eq("context_id",context.id).limit(limit);if(error)throw error;
  return{rows:data||[],freshness:{source:table,status:"current",metric_catalog:true}};
}

// Phase 96C. Deletion approvals stay in internal_approvals; the ActionEngine (copilot_action_requests) is not used for privacy.
export const PRIVACY_ACTION_ENGINE_DECISION={
  engine:"internal_approvals",
  reason:"copilot_action_requests tem lista fixa de ações operacionais ligada ao Copiloto, semântica de desfazer que não existe numa exclusão, e um before_state cujo uso natural guardaria os dados apagados. A trilha de privacidade guarda só contagens, domínios, IDs e hashes.",
  debt:"Se o ActionEngine ganhar um modo redigido garantido no banco (sem before_state de conteúdo), avaliar a migração das aprovações de privacidade.",
} as const;
