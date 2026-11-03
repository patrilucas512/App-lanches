/* eslint-disable @typescript-eslint/no-explicit-any */
/* Domain adapters. Each one says where a subject's data lives in its domain, how to export it, how to delete or anonymize
   it without breaking the domain, and how to check the result. Lookups go by key (customer, order, contact), never by scanning.
   Domains still without an adapter appear as manual steps, so a request touching them can only end as partially fulfilled. */
import {randomBytes} from "node:crypto";
import {anonymizeValue,reidentificationRisks,type SubjectRecord} from "./core.ts";

export type Subject={contextId:string;organizationId:string;subjectRef:string;organizationCustomerId:string|null;customerIds:string[];orderIds:string[];contactIds:string[];storeIds:string[]};
type Value={technique:string;keep?:string[]}|{literal:unknown};
type Spec={domain:string;table:string;key:string;by:Array<[column:string,source:keyof Subject]>;personal:string[];context?:string[];anonymize:Record<string,Value>;deleteRow?:boolean;anonymizeOnly?:boolean;legalRetention?:string;personalLinkFields?:string[];note?:string};

const anon=(literal:unknown):Value=>({literal}),hash:Value={technique:"hash"},mask:Value={technique:"mask"},none:Value={technique:"suppress"};
// The anonymized rows keep their keys, totals and dates, so orders still count in revenue and reports stay consistent.
export const ADAPTER_SPECS:Spec[]=[
  {domain:"customers",table:"customers",key:"id",by:[["id","customerIds"]],personal:["name","phone","email","birth_date","birthday","crm_notes","normalized_phone"],context:["created_at","last_order_at","total_orders"],anonymize:{name:anon("Cliente anonimizado"),phone:hash,normalized_phone:hash,email:none,birth_date:none,birthday:none,crm_notes:none,marketing_status:anon("opted_out")},anonymizeOnly:true,note:"Mantido anônimo para não quebrar pedidos e estatísticas."},
  {domain:"customers",table:"organization_customers",key:"id",by:[["id","organizationCustomerId"]],personal:["name","normalized_phone","email"],context:["first_order_at","last_order_at"],anonymize:{name:anon("Cliente anonimizado"),normalized_phone:hash,email:none},anonymizeOnly:true},
  {domain:"customers",table:"customer_addresses",key:"id",by:[["organization_customer_id","organizationCustomerId"],["customer_id","customerIds"]],personal:["label","postal_code","street","number","complement","neighborhood","reference"],anonymize:{},deleteRow:true},
  {domain:"customers",table:"customer360_notes",key:"id",by:[["customer_id","customerIds"]],personal:["note_type","content"],context:["created_at"],anonymize:{},deleteRow:true},
  {domain:"customers",table:"customer360_preferences",key:"id",by:[["customer_id","customerIds"]],personal:["preference_type","value","origin"],anonymize:{},deleteRow:true},
  {domain:"orders",table:"orders",key:"id",by:[["customer_id","customerIds"]],personal:["customer_name","customer_phone","delivery_address","notes"],context:["order_number","created_at","total_cents","status"],anonymize:{customer_name:anon("Cliente anonimizado"),customer_phone:hash,delivery_address:{technique:"generalize",keep:["neighborhood","city","state"]},notes:none},anonymizeOnly:true,note:"O pedido continua no faturamento; só o vínculo pessoal sai."},
  {domain:"delivery",table:"delivery_destinations",key:"delivery_order_id",by:[["delivery_order_id","orderIds"]],personal:["recipient_name","recipient_phone","postal_code","street","street_number","complement","neighborhood","city","reference","latitude","longitude"],anonymize:{recipient_name:anon("Anonimizado"),recipient_phone:mask,street:anon("—"),street_number:anon("—"),postal_code:none,complement:none,reference:none,latitude:none,longitude:none},anonymizeOnly:true},
  {domain:"reservations",table:"reservations",key:"id",by:[["customer_id","customerIds"],["organization_customer_id","organizationCustomerId"]],personal:["customer_name","customer_phone","notes"],context:["starts_at","party_size","status"],anonymize:{customer_name:anon("Anonimizado"),customer_phone:hash,notes:none},anonymizeOnly:true},
  {domain:"reservations",table:"waitlist_entries",key:"id",by:[["customer_id","customerIds"],["organization_customer_id","organizationCustomerId"]],personal:["customer_name","customer_phone","notes"],context:["joined_at","party_size","status"],anonymize:{customer_name:anon("Anonimizado"),customer_phone:hash,notes:none},anonymizeOnly:true},
  {domain:"whatsapp",table:"whatsapp_contacts",key:"id",by:[["customer_id","customerIds"]],personal:["wa_id","phone_number","name","profile_name","normalized_phone"],context:["first_message_at","last_message_at"],anonymize:{wa_id:hash,phone_number:hash,normalized_phone:hash,name:none,profile_name:none,marketing_opt_out:anon(true),marketing_status:anon("opted_out")},anonymizeOnly:true},
  {domain:"whatsapp",table:"whatsapp_messages",key:"id",by:[["contact_id","contactIds"]],personal:["content","media_reference"],context:["direction","message_timestamp"],anonymize:{content:anon("[removido a pedido do titular]"),media_reference:none},anonymizeOnly:true},
  {domain:"voice",table:"voice_call_sessions",key:"id",by:[["customer_id","customerIds"]],personal:["source_phone","customer_name","summary","recording_storage_path"],context:["started_at","state"],anonymize:{source_phone:hash,customer_name:none,summary:none,recording_storage_path:none},anonymizeOnly:true,note:"O arquivo da gravação no Storage é removido à parte (adapter de Storage pendente)."},
  {domain:"customer_experience",table:"crm_feedback",key:"id",by:[["customer_id","customerIds"]],personal:["comment"],context:["rating","score","created_at"],anonymize:{comment:none},anonymizeOnly:true,note:"Notas e scores ficam para os indicadores; o comentário sai."},
  {domain:"journeys",table:"customer_journey_enrollments",key:"id",by:[["customer_id","customerIds"]],personal:["context_snapshot","attribution_context"],context:["status","entered_at"],anonymize:{context_snapshot:anon({}),attribution_context:none},anonymizeOnly:true},
  {domain:"fiscal",table:"fiscal_documents",key:"id",by:[["customer_id","customerIds"]],personal:["customer_id"],context:["document_type","document_number","issued_at","total_cents"],anonymize:{customer_id:none},legalRetention:"fiscal",personalLinkFields:["customer_id"],note:"O documento fiscal é mantido pelo prazo legal; só o vínculo com o cadastro sai."},
  {domain:"financial",table:"order_payment_transactions",key:"id",by:[["order_id","orderIds"]],personal:["pix_key"],context:["created_at","status"],anonymize:{},legalRetention:"financial"},
  {domain:"consents",table:"consent_records",key:"id",by:[["customer_id","customerIds"]],personal:["purpose_key","channel","status","origin"],context:["recorded_at"],anonymize:{},legalRetention:"audit",note:"O histórico de consentimento e revogação é a prova de que o titular não deve receber marketing."},
];
// Domains the brief names that still lack an automated adapter. Each becomes a manual step a person confirms.
export const PENDING_ADAPTERS=[
  {domain:"workforce",note:"Dados de funcionários (Fase 18): atender pelo RH."},
  {domain:"drivers",note:"Dados de entregadores: localização já é apagada em 30 dias; perfil pelo módulo de entregadores."},
  {domain:"leads",note:"Leads do Sales CRM (Fase 29), no contexto MasterApp."},
  {domain:"data_platform",note:"Fatos e dimensões da Fase 34 (analytics_dim_customers) seguem a próxima carga."},
  {domain:"storage",note:"Arquivos (gravações, anexos, documentos) no Storage."},
  {domain:"marketplaces",note:"Pedir a exclusão ao parceiro (iFood e outros) quando o pedido veio de lá."},
] as const;
export const IMPLEMENTED_DOMAINS=[...new Set(ADAPTER_SPECS.map(x=>x.domain))];

const idsFor=(subject:Subject,source:keyof Subject)=>{const v=subject[source];return(Array.isArray(v)?v:v?[v]:[]).map(String).filter(Boolean)};
async function rowsFor(admin:any,spec:Spec,subject:Subject,columns:string){
  const out=new Map<string,any>();
  for(const[column,source]of spec.by){const ids=idsFor(subject,source);if(!ids.length)continue;
    const{data,error}=await admin.from(spec.table).select(columns).in(column,ids.slice(0,1000)).limit(5000);
    if(error)throw new Error(`${spec.table}: ${error.message}`);
    for(const row of data||[])out.set(String(row[spec.key]),row)}
  return[...out.values()];
}

// The subject inside its context: the network identity plus every store record and order that points to it.
export async function resolveSubject(admin:any,input:{contextId:string;organizationId:string;customerId?:string|null;organizationCustomerId?:string|null}):Promise<Subject|null>{
  const{data:stores}=await admin.from("establishments").select("id").eq("organization_id",input.organizationId);
  const storeIds=(stores||[]).map((x:any)=>x.id);if(!storeIds.length)return null;
  let organizationCustomerId=input.organizationCustomerId||null;
  if(!organizationCustomerId&&input.customerId){const{data}=await admin.from("customers").select("organization_customer_id,establishment_id").eq("id",input.customerId).maybeSingle();if(!data||!storeIds.includes(data.establishment_id))return null;organizationCustomerId=data.organization_customer_id||null}
  if(organizationCustomerId){const{data}=await admin.from("organization_customers").select("id").eq("id",organizationCustomerId).eq("organization_id",input.organizationId).maybeSingle();if(!data)return null}
  let query=admin.from("customers").select("id").in("establishment_id",storeIds);
  query=organizationCustomerId?query.eq("organization_customer_id",organizationCustomerId):query.eq("id",String(input.customerId||""));
  const{data:customers}=await query.limit(200);const customerIds=[...new Set([...(customers||[]).map((x:any)=>x.id),...(input.customerId?[input.customerId]:[])])] as string[];
  if(!customerIds.length&&!organizationCustomerId)return null;
  const[{data:orders},{data:contacts}]=await Promise.all([customerIds.length?admin.from("orders").select("id").in("customer_id",customerIds).limit(5000):{data:[]},customerIds.length?admin.from("whatsapp_contacts").select("id").in("customer_id",customerIds).limit(200):{data:[]}]);
  return{contextId:input.contextId,organizationId:input.organizationId,subjectRef:organizationCustomerId||customerIds[0],organizationCustomerId,customerIds,orderIds:(orders||[]).map((x:any)=>x.id),contactIds:(contacts||[]).map((x:any)=>x.id),storeIds};
}

export async function locateSubjectData(admin:any,subject:Subject):Promise<SubjectRecord[]>{
  const found:SubjectRecord[]=[];
  for(const spec of ADAPTER_SPECS){const rows=await rowsFor(admin,spec,subject,spec.key);for(const row of rows)found.push({domain:spec.domain,table:spec.table,recordId:String(row[spec.key]),categories:spec.personal,legalRetention:spec.legalRetention||null,personalLinkFields:spec.personalLinkFields,adapterStatus:"implemented",...(spec.anonymizeOnly?{anonymizeOnly:true}:{})} as any)}
  for(const pending of PENDING_ADAPTERS)found.push({domain:pending.domain,table:pending.domain,recordId:`domain:${pending.domain}`,categories:[],adapterStatus:"pending"});
  return found;
}

// Readable and structured: one section per domain, with the personal fields and enough context to recognise each record.
export async function exportSubjectData(admin:any,subject:Subject){
  const domains:Record<string,any>={},missing:string[]=PENDING_ADAPTERS.map(x=>x.domain);
  for(const spec of ADAPTER_SPECS){const rows=await rowsFor(admin,spec,subject,[spec.key,...spec.personal,...(spec.context||[])].join(","));if(!rows.length)continue;(domains[spec.domain]||={})[spec.table]=rows}
  return{generatedAt:new Date().toISOString(),subject:{reference:subject.subjectRef},domains,missingDomains:missing,notice:"Dados de domínios ainda sem exportação automática são atendidos à parte e listados em missingDomains."};
}

export async function contextSalt(admin:any,contextId:string){
  const{data}=await admin.from("privacy_pseudonym_salts").select("salt").eq("context_id",contextId).maybeSingle();
  if(data?.salt)return String(data.salt);
  await admin.from("privacy_pseudonym_salts").upsert({context_id:contextId,salt:randomBytes(32).toString("hex")},{onConflict:"context_id",ignoreDuplicates:true});
  const{data:stored,error}=await admin.from("privacy_pseudonym_salts").select("salt").eq("context_id",contextId).single();
  if(error)throw new Error(`sal: ${error.message}`);return String(stored.salt);
}

export function anonymizedPatch(spec:Pick<Spec,"anonymize">,row:Record<string,any>,salt:string){
  const patch:Record<string,unknown>={};
  for(const[column,how]of Object.entries(spec.anonymize))patch[column]="literal" in how?how.literal:anonymizeValue(how.technique,row[column],{salt,keep:how.keep});
  return patch;
}
const specFor=(table:string)=>{const spec=ADAPTER_SPECS.find(x=>x.table===table);if(!spec)throw new Error("ADAPTER_NOT_FOUND");return spec};

// Idempotent: deleting a row that is gone or anonymizing a row already anonymized ends in the same state.
export async function executeStep(admin:any,step:{table_name:string;record_ref:string;decision:string},salt:string){
  const spec=specFor(step.table_name);
  if(step.decision==="retain")return{status:"skipped_retained"};
  if(step.decision==="delete"&&spec.deleteRow&&!spec.anonymizeOnly){const{error}=await admin.from(spec.table).delete().eq(spec.key,step.record_ref);if(error)throw new Error(error.message);return{status:"completed"}}
  const{data:row,error}=await admin.from(spec.table).select([spec.key,...Object.keys(spec.anonymize)].join(",")).eq(spec.key,step.record_ref).maybeSingle();
  if(error)throw new Error(error.message);
  if(!row)return{status:"completed"};
  const patch=step.decision==="block"?{}:anonymizedPatch(spec,row,salt);
  if(Object.keys(patch).length){const{error:updateError}=await admin.from(spec.table).update(patch).eq(spec.key,step.record_ref);if(updateError)throw new Error(updateError.message)}
  return{status:"completed"};
}

export async function verifyStep(admin:any,step:{table_name:string;record_ref:string;decision:string}){
  const spec=specFor(step.table_name);
  if(step.decision==="retain"||step.decision==="block")return true;
  const columns=Object.keys(spec.anonymize).length?Object.keys(spec.anonymize):[spec.key];
  const{data:row,error}=await admin.from(spec.table).select([spec.key,...columns].join(",")).eq(spec.key,step.record_ref).maybeSingle();
  if(error)throw new Error(error.message);
  if(!row)return true;
  if(step.decision==="delete"&&spec.deleteRow&&!spec.anonymizeOnly)return false;
  const kept=Object.fromEntries(columns.filter(c=>c!==spec.key).map(c=>[c,row[c]]));
  return reidentificationRisks(kept,Object.entries(spec.anonymize).filter(([,how])=>"literal" in how).map(([c])=>c)).length===0;
}
