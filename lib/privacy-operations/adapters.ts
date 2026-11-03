/* eslint-disable @typescript-eslint/no-explicit-any */
/* Domain adapters. Each one says where a subject's data lives in its domain, how to export it, how to delete or anonymize
   it without breaking the domain, and how to check the result. Lookups go by key (customer, employee, driver, lead, order),
   never by scanning. What the law makes us keep is marked "retain", and only its personal link is anonymized. */
import {createHash,randomBytes} from "node:crypto";
import {anonymizeValue,reidentificationRisks,type SubjectRecord} from "./core.ts";

export type Subject={contextId:string;organizationId:string|null;subjectCategory:string;subjectRef:string;organizationCustomerId:string|null;customerIds:string[];orderIds:string[];contactIds:string[];storeIds:string[];
  employeeIds:string[];driverIds:string[];leadIds:string[];salesContactIds:string[];snapshotIds:string[];marketplaceConnections:string[];packageIds:string[];voiceCallIds:string[]};
type Value={technique:string;keep?:string[]}|{literal:unknown};
// A storage spec owns a file column: the step reads the path, removes the object and clears the column, keeping only a hash.
type StorageRef={bucket:string|null;column:string;format:"path"|"public_url";afterRemove?:"clear"|"delete_row"};
type Spec={domain:string;table:string;key:string;by:Array<[column:string,source:keyof Subject]>;personal:string[];context?:string[];anonymize:Record<string,Value>;deleteRow?:boolean;anonymizeOnly?:boolean;legalRetention?:string;personalLinkFields?:string[];note?:string;storage?:StorageRef;step?:string};

const anon=(literal:unknown):Value=>({literal}),hash:Value={technique:"hash"},mask:Value={technique:"mask"},none:Value={technique:"suppress"},now:Value={technique:"now"};
const CUSTOMER_KEYS=["customer_name","customer_phone","customer_email","customer_document","delivery_address","customer","recipient_name","recipient_phone"];
// The anonymized rows keep their keys, totals and dates, so orders still count in revenue and reports stay consistent.
export const ADAPTER_SPECS:Spec[]=[
  // Customers (Phase 95).
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
  {domain:"whatsapp",table:"normalized_messages",key:"id",by:[["customer_id","customerIds"]],personal:["text_content","media"],context:["channel_type","occurred_at"],anonymize:{text_content:anon("[removido a pedido do titular]"),media:anon([])},anonymizeOnly:true},
  // A recording path whose bucket is not known cannot be removed automatically, so it becomes a manual step.
  {domain:"storage",table:"voice_call_sessions",step:"storage:voice_recordings",key:"id",by:[["customer_id","customerIds"]],personal:["recording_storage_path"],anonymize:{},storage:{bucket:null,column:"recording_storage_path",format:"path"}},
  {domain:"voice",table:"voice_call_sessions",key:"id",by:[["customer_id","customerIds"]],personal:["source_phone","customer_name","summary"],context:["started_at","state"],anonymize:{source_phone:hash,customer_name:none,summary:none},anonymizeOnly:true},
  {domain:"voice",table:"voice_transcript_segments",key:"id",by:[["call_session_id","voiceCallIds"]],personal:["redacted_text"],context:["speaker","created_at"],anonymize:{redacted_text:anon("[removido a pedido do titular]")},anonymizeOnly:true},
  {domain:"customer_experience",table:"crm_feedback",key:"id",by:[["customer_id","customerIds"]],personal:["comment"],context:["rating","score","created_at"],anonymize:{comment:none},anonymizeOnly:true,note:"Notas e scores ficam para os indicadores; o comentário sai."},
  {domain:"journeys",table:"customer_journey_enrollments",key:"id",by:[["customer_id","customerIds"]],personal:["context_snapshot","attribution_context"],context:["status","entered_at"],anonymize:{context_snapshot:anon({}),attribution_context:none},anonymizeOnly:true},
  {domain:"fiscal",table:"fiscal_documents",key:"id",by:[["customer_id","customerIds"]],personal:["customer_id"],context:["document_type","document_number","issued_at","total_cents"],anonymize:{customer_id:none},legalRetention:"fiscal",personalLinkFields:["customer_id"],note:"O documento fiscal é mantido pelo prazo legal; só o vínculo com o cadastro sai."},
  {domain:"financial",table:"order_payment_transactions",key:"id",by:[["order_id","orderIds"]],personal:["pix_key"],context:["created_at","status"],anonymize:{},legalRetention:"financial"},
  {domain:"consents",table:"consent_records",key:"id",by:[["customer_id","customerIds"]],personal:["purpose_key","channel","status","origin"],context:["recorded_at"],anonymize:{},legalRetention:"audit",note:"O histórico de consentimento e revogação é a prova de que o titular não deve receber marketing."},
  // Data Platform (Phase 34): the dimension keeps its pseudonym and is marked anonymized; the per-customer mart row goes.
  // Daily facts never had names or phones, so revenue and order totals stay exactly as they were.
  {domain:"data_platform",table:"analytics_dim_customers",key:"customer_key",by:[["customer_id","customerIds"]],personal:["pseudonym"],context:["first_seen_at"],anonymize:{anonymized_at:now},anonymizeOnly:true},
  {domain:"data_platform",table:"analytics_customer_360",key:"customer_id",by:[["customer_id","customerIds"]],personal:["first_order_at","last_order_at","order_count","revenue_cents"],anonymize:{},deleteRow:true},
  // Marketplaces (Phase 69): the order snapshot keeps the order and loses the customer fields.
  {domain:"marketplaces",table:"marketplace_order_snapshots",key:"id",by:[["id","snapshotIds"]],personal:["normalized_snapshot"],context:["external_display_id","created_at"],anonymize:{normalized_snapshot:{technique:"redact_keys",keep:CUSTOMER_KEYS}},anonymizeOnly:true},
  // Old access packages of this subject are removed with the rest.
  {domain:"storage",table:"privacy_export_packages",step:"storage:privacy_exports",key:"id",by:[["id","packageIds"]],personal:["storage_path"],anonymize:{},storage:{bucket:"privacy-exports",column:"storage_path",format:"path",afterRemove:"delete_row"}},

  // Workforce (Phase 18). Labor records (shifts, time clock, documents, evaluations) stay by law; the person behind them is
  // anonymized in custom_staff_members, which is what pseudonymizes every one of those links at once.
  {domain:"storage",table:"custom_staff_members",step:"storage:staff_photos",key:"id",by:[["id","employeeIds"]],personal:["photo_url"],anonymize:{},storage:{bucket:"product-images",column:"photo_url",format:"public_url"}},
  {domain:"workforce",table:"custom_staff_members",key:"id",by:[["id","employeeIds"]],personal:["name","phone","notes"],context:["hire_date","termination_date","status"],anonymize:{name:anon("Funcionário anonimizado"),phone:none,notes:none},anonymizeOnly:true,note:"Fica o cadastro anônimo, porque ponto, escalas e caixa apontam para ele."},
  {domain:"workforce",table:"employee_availability",key:"id",by:[["employee_id","employeeIds"]],personal:["notes","available_on","day_of_week"],anonymize:{},deleteRow:true},
  {domain:"workforce",table:"employee_notification_preferences",key:"employee_id",by:[["employee_id","employeeIds"]],personal:["shift_reminders","swap_updates"],anonymize:{},deleteRow:true},
  {domain:"workforce",table:"work_shifts",key:"id",by:[["employee_id","employeeIds"]],personal:["shift_date","starts_at","ends_at"],anonymize:{},legalRetention:"labor",note:"Escala é registro trabalhista."},
  {domain:"workforce",table:"time_clock_entries",key:"id",by:[["employee_id","employeeIds"]],personal:["occurred_at","entry_type","device_id"],anonymize:{},legalRetention:"labor",note:"Ponto é registro trabalhista obrigatório."},
  {domain:"workforce",table:"employee_documents",key:"id",by:[["employee_id","employeeIds"]],personal:["file_name"],anonymize:{},legalRetention:"labor"},
  {domain:"workforce",table:"employee_evaluations",key:"id",by:[["employee_id","employeeIds"]],personal:["notes"],anonymize:{},legalRetention:"labor",note:"Avaliações ficam até o jurídico trabalhista dizer o contrário."},
  {domain:"workforce",table:"employee_feedback",key:"id",by:[["employee_id","employeeIds"]],personal:["feedback"],anonymize:{},legalRetention:"labor"},
  {domain:"financial",table:"cash_movements",key:"id",by:[["staff_member_id","employeeIds"]],personal:["operator_name"],context:["occurred_at","amount_cents"],anonymize:{operator_name:anon("Operador anonimizado")},legalRetention:"financial",personalLinkFields:["operator_name"],note:"O movimento de caixa fica; o nome do operador sai."},

  // Drivers (Phases 5–11, 40). Proof of delivery and payouts stay by law, linked to the anonymized driver profile.
  {domain:"drivers",table:"driver_profiles",key:"id",by:[["id","driverIds"]],personal:["phone","vehicle_plate","vehicle_model","cpf_last4"],context:["status"],anonymize:{phone:hash,vehicle_plate:none,vehicle_model:none,cpf_last4:none},anonymizeOnly:true,note:"O hash do CPF fica para os repasses (obrigação financeira); telefone e veículo saem."},
  {domain:"drivers",table:"driver_access_links",key:"id",by:[["driver_profile_id","driverIds"]],personal:["token_hash"],anonymize:{},deleteRow:true},
  {domain:"drivers",table:"driver_locations",key:"id",by:[["driver_profile_id","driverIds"]],personal:["latitude","longitude","captured_at"],anonymize:{},deleteRow:true},
  {domain:"drivers",table:"deliveries",key:"id",by:[["delivered_driver_profile_id","driverIds"]],personal:["delivery_latitude","delivery_longitude"],context:["delivered_at","delivery_confirmation_method"],anonymize:{},legalRetention:"delivery_proof",note:"Comprovante de entrega fica; aponta para o perfil anônimo."},
  {domain:"financial",table:"driver_financial_entries",key:"id",by:[["driver_profile_id","driverIds"]],personal:["amount_cents","reason"],anonymize:{},legalRetention:"financial"},
  {domain:"financial",table:"driver_financial_closures",key:"id",by:[["driver_profile_id","driverIds"]],personal:["notes"],anonymize:{},legalRetention:"financial"},

  // Leads (Phase 29), with MasterApp as controller. Accepted proposals and conversion handoffs are contracts and stay.
  {domain:"leads",table:"sales_leads",key:"id",by:[["id","leadIds"]],personal:["contact_name","email","phone","city","state","pain_points","notes"],context:["source","status","created_at"],anonymize:{contact_name:anon("Lead anonimizado"),email:none,phone:none,city:none,state:none,pain_points:none,notes:none,first_touch:anon({}),last_touch:anon({})},anonymizeOnly:true},
  {domain:"leads",table:"sales_contacts",key:"id",by:[["id","salesContactIds"]],personal:["name","email","phone","notes"],context:["role"],anonymize:{name:anon("Contato anonimizado"),email:none,phone:none,notes:none},anonymizeOnly:true},
];
export const stepTable=(s:Spec)=>s.step||s.table;
// Partners without an erasure API: a manual step with instructions, so the request stays partial until someone confirms.
export const MARKETPLACE_MANUAL_NOTE="Peça a exclusão ao parceiro pelo canal dele, guarde o protocolo e confirme aqui. Sem confirmação, a solicitação fica atendida em parte.";
export const IMPLEMENTED_DOMAINS=[...new Set(ADAPTER_SPECS.map(x=>x.domain))];
// Kept for the screens: domains still handled by hand, and why.
export const PENDING_ADAPTERS=[
  {domain:"marketplace_partner",note:MARKETPLACE_MANUAL_NOTE},
  {domain:"voice_recordings",note:"Gravações com caminho mas sem bucket conhecido: remover no Storage e confirmar aqui."},
] as const;

const idsFor=(subject:Subject,source:keyof Subject)=>{const v=subject[source];return(Array.isArray(v)?v:v?[v]:[]).map(String).filter(Boolean)};
async function rowsFor(admin:any,spec:Spec,subject:Subject,columns:string){
  const out=new Map<string,any>();
  for(const[column,source]of spec.by){const ids=idsFor(subject,source);if(!ids.length)continue;
    const{data,error}=await admin.from(spec.table).select(columns).in(column,ids.slice(0,1000)).limit(5000);
    if(error)throw new Error(`${spec.table}: ${error.message}`);
    for(const row of data||[])out.set(String(row[spec.key]),row)}
  return[...out.values()];
}
const empty=(input:{contextId:string;organizationId:string|null},category:string,ref:string):Subject=>({contextId:input.contextId,organizationId:input.organizationId,subjectCategory:category,subjectRef:ref,organizationCustomerId:null,customerIds:[],orderIds:[],contactIds:[],storeIds:[],employeeIds:[],driverIds:[],leadIds:[],salesContactIds:[],snapshotIds:[],marketplaceConnections:[],packageIds:[],voiceCallIds:[]});
async function packagesOf(admin:any,contextId:string,subjectRef:string){
  const{data:requests}=await admin.from("customer_privacy_requests").select("id").eq("context_id",contextId).eq("subject_ref",subjectRef).limit(200);
  const ids=(requests||[]).map((r:any)=>r.id);if(!ids.length)return[];
  const{data}=await admin.from("privacy_export_packages").select("id").in("request_id",ids).limit(500);return(data||[]).map((x:any)=>x.id);
}

// The customer inside its context: the network identity plus every store record, order and marketplace snapshot.
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
  const[{data:orders},{data:contacts},{data:calls}]=await Promise.all([customerIds.length?admin.from("orders").select("id").in("customer_id",customerIds).limit(5000):{data:[]},customerIds.length?admin.from("whatsapp_contacts").select("id").in("customer_id",customerIds).limit(200):{data:[]},customerIds.length?admin.from("voice_call_sessions").select("id").in("customer_id",customerIds).limit(2000):{data:[]}]);
  const orderIds=(orders||[]).map((x:any)=>x.id),{data:links}=orderIds.length?await admin.from("marketplace_order_links").select("snapshot_id,connection_id").in("internal_order_id",orderIds.slice(0,1000)):{data:[]};
  const subject=empty(input,"end_customer",organizationCustomerId||customerIds[0]);
  return{...subject,organizationCustomerId,customerIds,orderIds,contactIds:(contacts||[]).map((x:any)=>x.id),storeIds,snapshotIds:(links||[]).map((x:any)=>x.snapshot_id),marketplaceConnections:[...new Set((links||[]).map((x:any)=>x.connection_id))] as string[],packageIds:await packagesOf(admin,input.contextId,subject.subjectRef),voiceCallIds:(calls||[]).map((x:any)=>x.id)};
}

// An employee or a driver: both start at the staff member, and a driver profile hangs from it.
export async function resolveStaffSubject(admin:any,input:{contextId:string;organizationId:string;staffMemberId:string;category:"employee"|"driver"}):Promise<Subject|null>{
  const{data:stores}=await admin.from("establishments").select("id").eq("organization_id",input.organizationId);
  const storeIds=(stores||[]).map((x:any)=>x.id);
  const{data:member}=await admin.from("custom_staff_members").select("id,establishment_id").eq("id",input.staffMemberId).maybeSingle();
  if(!member||!storeIds.includes(member.establishment_id))return null;
  const{data:drivers}=await admin.from("driver_profiles").select("id").eq("custom_staff_member_id",member.id);
  const subject=empty(input,input.category,`staff:${member.id}`);
  return{...subject,storeIds,employeeIds:[member.id],driverIds:(drivers||[]).map((x:any)=>x.id),packageIds:await packagesOf(admin,input.contextId,subject.subjectRef)};
}

// A lead of the SaaS. MasterApp is the controller here, so this only exists in the platform context.
export async function resolveLeadSubject(admin:any,input:{contextId:string;leadId:string}):Promise<Subject|null>{
  const{data:lead}=await admin.from("sales_leads").select("id,email").eq("id",input.leadId).maybeSingle();
  if(!lead)return null;
  const{data:contacts}=lead.email?await admin.from("sales_contacts").select("id").eq("email",lead.email).limit(50):{data:[]};
  const subject=empty({contextId:input.contextId,organizationId:null},"lead",`lead:${lead.id}`);
  return{...subject,leadIds:[lead.id],salesContactIds:(contacts||[]).map((x:any)=>x.id),packageIds:await packagesOf(admin,input.contextId,subject.subjectRef)};
}

// One entry point for requests, from what the request row says about its subject.
export async function resolveRequestSubject(admin:any,ctx:{contextId:string;organizationId:string|null},request:{subject_category?:string|null;subject_ref?:string|null;customer_id?:string|null;organization_customer_id?:string|null}){
  const ref=String(request.subject_ref||""),category=request.subject_category||"end_customer";
  if(["employee","driver"].includes(category)&&ref.startsWith("staff:")&&ctx.organizationId)return resolveStaffSubject(admin,{contextId:ctx.contextId,organizationId:ctx.organizationId,staffMemberId:ref.slice(6),category:category as "employee"|"driver"});
  if(category==="lead"&&ref.startsWith("lead:"))return resolveLeadSubject(admin,{contextId:ctx.contextId,leadId:ref.slice(5)});
  if(!ctx.organizationId)return null;
  return resolveSubject(admin,{contextId:ctx.contextId,organizationId:ctx.organizationId,customerId:request.customer_id,organizationCustomerId:request.organization_customer_id});
}

export async function locateSubjectData(admin:any,subject:Subject):Promise<SubjectRecord[]>{
  const found:SubjectRecord[]=[];
  const results=await Promise.all(ADAPTER_SPECS.map(spec=>rowsFor(admin,spec,subject,spec.storage?[spec.key,spec.storage.column].join(","):spec.key)));
  for(const[index,spec]of ADAPTER_SPECS.entries()){
    for(const row of results[index]){
      if(spec.storage&&!row[spec.storage.column])continue;
      found.push({domain:spec.domain,table:stepTable(spec),recordId:String(row[spec.key]),categories:spec.personal,legalRetention:spec.legalRetention||null,personalLinkFields:spec.personalLinkFields,adapterStatus:spec.storage&&!spec.storage.bucket?"pending":"implemented",anonymizeOnly:spec.anonymizeOnly});
    }
  }
  for(const connection of subject.marketplaceConnections)found.push({domain:"marketplaces",table:"marketplace_partner",recordId:`partner:${connection}`,categories:[],adapterStatus:"pending"});
  return found;
}

// Readable and structured: one section per domain, with the personal fields and enough context to recognise each record.
export async function exportSubjectData(admin:any,subject:Subject){
  const domains:Record<string,any>={},specs=ADAPTER_SPECS.filter(s=>!s.storage);
  const results=await Promise.all(specs.map(spec=>rowsFor(admin,spec,subject,[spec.key,...spec.personal,...(spec.context||[])].join(","))));
  specs.forEach((spec,i)=>{if(results[i].length)(domains[spec.domain]||={})[spec.table]=results[i]});
  const missing=subject.marketplaceConnections.length?["marketplace_partner"]:[];
  return{generatedAt:new Date().toISOString(),subject:{reference:subject.subjectRef,category:subject.subjectCategory},domains,missingDomains:missing,notice:missing.length?"Os dados que o parceiro de marketplace guarda são pedidos a ele, pelo canal do parceiro.":"Este pacote traz os dados de todos os domínios do MasterApp."};
}

export async function contextSalt(admin:any,contextId:string){
  const{data}=await admin.from("privacy_pseudonym_salts").select("salt").eq("context_id",contextId).maybeSingle();
  if(data?.salt)return String(data.salt);
  await admin.from("privacy_pseudonym_salts").upsert({context_id:contextId,salt:randomBytes(32).toString("hex")},{onConflict:"context_id",ignoreDuplicates:true});
  const{data:stored,error}=await admin.from("privacy_pseudonym_salts").select("salt").eq("context_id",contextId).single();
  if(error)throw new Error(`sal: ${error.message}`);return String(stored.salt);
}

const redactKeys=(value:any,keys:string[]):any=>Array.isArray(value)?value.map(v=>redactKeys(v,keys)):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).filter(([k])=>!keys.includes(k)).map(([k,v])=>[k,redactKeys(v,keys)])):value;
export function anonymizedPatch(spec:Pick<Spec,"anonymize">,row:Record<string,any>,salt:string){
  const patch:Record<string,unknown>={};
  for(const[column,how]of Object.entries(spec.anonymize)){
    if("literal" in how)patch[column]=how.literal;
    else if(how.technique==="now")patch[column]=row[column]||new Date().toISOString();
    else if(how.technique==="redact_keys")patch[column]=redactKeys(row[column],how.keep||[]);
    else patch[column]=anonymizeValue(how.technique,row[column],{salt,keep:how.keep});
  }
  return patch;
}
const specFor=(table:string)=>{const spec=ADAPTER_SPECS.find(x=>stepTable(x)===table);if(!spec)throw new Error("ADAPTER_NOT_FOUND");return spec};
const objectPath=(ref:StorageRef,value:string)=>{if(ref.format==="path")return value;const marker=`/object/public/${ref.bucket}/`,i=value.indexOf(marker);return i>=0?decodeURIComponent(value.slice(i+marker.length).split("?")[0]):null};
export const pathFingerprint=(path:string)=>createHash("sha256").update(path).digest("hex");

// Idempotent: deleting a row that is gone or anonymizing a row already anonymized ends in the same state.
export async function executeStep(admin:any,step:{table_name:string;record_ref:string;decision:string},salt:string):Promise<{status:string;evidence?:Record<string,unknown>}>{
  const spec=specFor(step.table_name);
  if(step.decision==="retain")return{status:"skipped_retained"};
  if(spec.storage){
    const{data:row,error}=await admin.from(spec.table).select(`${spec.key},${spec.storage.column}`).eq(spec.key,step.record_ref).maybeSingle();
    if(error)throw new Error(error.message);
    const value=row?.[spec.storage.column];if(!value)return{status:"completed"};
    const path=objectPath(spec.storage,String(value));if(!spec.storage.bucket||!path)throw new Error("STORAGE_PATH_UNKNOWN");
    // The evidence is the bucket and a hash of the path: proof that a file went, never its name or content.
    const{error:removeError}=await admin.storage.from(spec.storage.bucket).remove([path]);if(removeError)throw new Error(`storage: ${removeError.message}`);
    // A row that is only a pointer to the file (an access package) goes with it; otherwise the column is cleared.
    const{error:clearError}=spec.storage.afterRemove==="delete_row"?await admin.from(spec.table).delete().eq(spec.key,step.record_ref):await admin.from(spec.table).update({[spec.storage.column]:null}).eq(spec.key,step.record_ref);if(clearError)throw new Error(clearError.message);
    return{status:"completed",evidence:{bucket:spec.storage.bucket,path_sha256:pathFingerprint(path)}};
  }
  if(step.decision==="delete"&&spec.deleteRow&&!spec.anonymizeOnly){const{error}=await admin.from(spec.table).delete().eq(spec.key,step.record_ref);if(error)throw new Error(error.message);return{status:"completed"}}
  const{data:row,error}=await admin.from(spec.table).select([spec.key,...Object.keys(spec.anonymize)].join(",")).eq(spec.key,step.record_ref).maybeSingle();
  if(error)throw new Error(error.message);
  if(!row)return{status:"completed"};
  const patch=step.decision==="block"?{}:anonymizedPatch(spec,row,salt);
  if(Object.keys(patch).length){const{error:updateError}=await admin.from(spec.table).update(patch).eq(spec.key,step.record_ref);if(updateError)throw new Error(updateError.message)}
  return{status:"completed"};
}

const hasKey=(value:any,keys:string[]):boolean=>Array.isArray(value)?value.some(v=>hasKey(v,keys)):value&&typeof value==="object"?Object.entries(value).some(([k,v])=>keys.includes(k)||hasKey(v,keys)):false;
export async function verifyStep(admin:any,step:{table_name:string;record_ref:string;decision:string}){
  const spec=specFor(step.table_name);
  if(step.decision==="retain"||step.decision==="block")return true;
  if(spec.storage){const{data:row}=await admin.from(spec.table).select(`${spec.key},${spec.storage.column}`).eq(spec.key,step.record_ref).maybeSingle();return !row?.[spec.storage.column]}
  const columns=Object.keys(spec.anonymize).length?Object.keys(spec.anonymize):[spec.key];
  const{data:row,error}=await admin.from(spec.table).select([spec.key,...columns].join(",")).eq(spec.key,step.record_ref).maybeSingle();
  if(error)throw new Error(error.message);
  if(!row)return true;
  if(step.decision==="delete"&&spec.deleteRow&&!spec.anonymizeOnly)return false;
  const redacted=Object.entries(spec.anonymize).filter(([,how])=>"technique" in how&&how.technique==="redact_keys");
  if(redacted.some(([c,how])=>hasKey(row[c],(how as any).keep||[])))return false;
  const kept=Object.fromEntries(columns.filter(c=>c!==spec.key&&!redacted.some(([r])=>r===c)).map(c=>[c,row[c]]));
  return reidentificationRisks(kept,Object.entries(spec.anonymize).filter(([,how])=>"literal" in how||(how as any).technique==="now").map(([c])=>c)).length===0;
}
