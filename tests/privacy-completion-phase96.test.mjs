import test from"node:test";import assert from"node:assert/strict";import{readFile,readdir}from"node:fs/promises";
import{PRIVACY_FLAGS,PRIVACY_PERMISSIONS,reidentificationRisks}from"../lib/privacy-operations/core.ts";
import{ADAPTER_SPECS,locateSubjectData,resolveLeadSubject,resolveStaffSubject,resolveSubject}from"../lib/privacy-operations/adapters.ts";
import{createRequest}from"../lib/privacy-operations/dsr.ts";
import{confirmManualStep,decidePlan,executePlan,previewDeletion,requestPlanApproval}from"../lib/privacy-operations/deletion.ts";
import{decideRetentionRun,requestRetentionRun,runRetention}from"../lib/privacy-operations/retention.ts";
import{PRIVACY_POLICY_KEYS,previewDeadlineImpact,privacyPolicyTemplates}from"../lib/privacy-operations/policies.ts";
import{enableStore,goLiveGate}from"../lib/privacy-operations/golive.ts";
import{marketingConsentGate}from"../lib/privacy-operations/consents.ts";
import{PRIVACY_ACTION_ENGINE_DECISION}from"../lib/privacy-operations/integrations.ts";
import{isNotInstalled}from"../lib/privacy-operations/server.ts";
import{AccessCatalogService}from"../lib/identity-governance/core.ts";
const file=p=>readFile(new URL(p,import.meta.url),"utf8");
const migrations=async(tag="_phase96")=>{const dir=new URL("../supabase/migrations/",import.meta.url),names=(await readdir(dir)).filter(x=>x.includes(tag)).sort();return(await Promise.all(names.map(x=>readFile(new URL(x,dir),"utf8")))).join("\n")};

// In-memory stand-in for the Supabase client: query builder, RPC and Storage, enough to run the services for real.
function fakeDb(seed={},options={}){const tables=Object.fromEntries(Object.entries(seed).map(([k,v])=>[k,v.map(x=>({...x}))]));let serial=0;const removed=[];
 const db={tables,removed,
 rpc:async()=>({data:null,error:{message:"rpc not faked"}}),
 storage:{from:bucket=>({upload:async()=>({data:{},error:null}),createSignedUrl:async p=>({data:{signedUrl:`https://signed.test/${p}`},error:null}),remove:async paths=>{removed.push(...paths.map(p=>`${bucket}/${p}`));return{data:[],error:null}}})},
 from(table){tables[table]||=[];const q={op:"select",filters:[],row:null,opts:{},head:false,rangeFrom:null,rangeTo:null,
  select(_c,o){if(q.op==="select"&&o?.head)q.head=true;return q},eq(k,v){q.filters.push(x=>x[k]===v);return q},neq(k,v){q.filters.push(x=>x[k]!=null&&x[k]!==v);return q},in(k,v){q.filters.push(x=>v.includes(x[k]));return q},is(k,v){q.filters.push(x=>(x[k]??null)===v);return q},gte(k,v){q.filters.push(x=>x[k]>=v);return q},gt(k,v){q.filters.push(x=>x[k]>v);return q},lte(k,v){q.filters.push(x=>x[k]<=v);return q},lt(k,v){q.filters.push(x=>x[k]!=null&&x[k]<v);return q},like(k,v){const re=new RegExp("^"+v.replace(/[.]/g,"\\.").replace(/%/g,".*")+"$");q.filters.push(x=>re.test(String(x[k])));return q},
  not(k,op,v){q.filters.push(x=>op==="is"?(x[k]??null)!==v:!String(v).replace(/[()]/g,"").split(",").includes(String(x[k])));return q},or(){return q},order(){return q},limit(){return q},range(a,b){q.rangeFrom=a;q.rangeTo=b;return q},
  insert(row){q.op="insert";q.row=row;return q},update(row){q.op="update";q.row=row;return q},upsert(row,o){q.op="upsert";q.row=row;q.opts=o||{};return q},delete(){q.op="delete";return q},
  run(){const fail=options.fail?.({table,op:q.op});if(fail)return{data:null,error:fail};if(options.missing?.includes(table))return{data:null,error:{code:"PGRST205",message:"Could not find the table in the schema cache"}};
   let match=tables[table].filter(x=>q.filters.every(f=>f(x)));
   if(q.op==="select"){const count=match.length;if(q.rangeFrom!=null)match=match.slice(q.rangeFrom,q.rangeTo+1);return{data:match.map(x=>({...x})),count,error:null}}
   if(q.op==="insert"){const rows=(Array.isArray(q.row)?q.row:[q.row]).map(x=>({id:`${table}-${++serial}`,created_at:new Date(Date.now()+serial).toISOString(),...x}));
    if(table==="customer_privacy_requests")rows.forEach(r=>{r.status||="received";r.received_at||=r.created_at;r.outcome||={}});
    if(table==="privacy_deletion_steps")rows.forEach(r=>{r.attempts??=0});if(table==="privacy_deletion_plans")rows.forEach(r=>{r.status||="previewed"});
    if(table==="legal_holds")rows.forEach(r=>{r.status||="active"});if(table==="retention_runs")rows.forEach(r=>{r.status||="previewed"});
    tables[table].push(...rows);return{data:rows.map(x=>({...x})),error:null}}
   if(q.op==="update"){if(table==="store_feature_flags"&&q.row.privacy_operations_enabled===true&&options.goLiveTrigger){const rec=(tables.privacy_go_live_records||[]).find(r=>!r.consumed_at);if(!rec)return{data:null,error:{message:"PRIVACY_GO_LIVE_REQUIRED"}};rec.consumed_at="now"}
    match.forEach(x=>Object.assign(x,q.row));return{data:match.map(x=>({...x})),error:null}}
   if(q.op==="delete"){tables[table]=tables[table].filter(x=>!match.includes(x));return{data:match,error:null}}
   const keys=String(q.opts.onConflict||"id").split(","),rows=Array.isArray(q.row)?q.row:[q.row],out=[];for(const row of rows){const existing=tables[table].find(x=>keys.every(k=>x[k]===row[k]));if(existing){if(!q.opts.ignoreDuplicates)Object.assign(existing,row);out.push(existing)}else{const created={id:row.id||`${table}-${++serial}`,...row};tables[table].push(created);out.push(created)}}return{data:out,error:null}},
  single(){const r=q.run();return Promise.resolve({data:r.data?.[0]??null,error:r.error||(r.data?.length?null:{message:"no rows"})})},maybeSingle(){const r=q.run();return Promise.resolve({data:r.data?.[0]??null,error:r.error})},then(ok,no){const r=q.run();return Promise.resolve(q.head?{count:r.count,data:null,error:r.error}:r).then(ok,no)}};return q}};return db}

const OLD="2025-01-01T00:00:00Z",PHOTO="https://x.supabase.co/storage/v1/object/public/product-images/s1/team/employee-1.jpg";
// One fictitious person in every domain: customer (orders, messages, voice, marketplace, analytics) and also employee and driver.
const seed=()=>({
 establishments:[{id:"s1",organization_id:"o",name:"Loja Teste"},{id:"x1",organization_id:"other"}],
 store_feature_flags:[{establishment_id:"s1",privacy_operations_enabled:true}],
 privacy_contexts:[{id:"ctx",organization_id:"o",kind:"tenant_controller"},{id:"plat",organization_id:null,kind:"platform_controller"}],
 organization_customers:[{id:"oc1",organization_id:"o",name:"Maria Teste",normalized_phone:"5511900000001",email:"maria@teste.dev"}],
 customers:[{id:"c1",establishment_id:"s1",organization_customer_id:"oc1",name:"Maria Teste",phone:"(11) 90000-0001",email:"maria@teste.dev",crm_notes:"nota",normalized_phone:"5511900000001",establishments:{organization_id:"o"}}],
 customer_addresses:[{id:"a1",customer_id:"c1",organization_customer_id:"oc1",street:"Rua Teste",number:"10"}],
 orders:[{id:"o1",establishment_id:"s1",customer_id:"c1",customer_name:"Maria Teste",customer_phone:"(11) 90000-0001",delivery_address:{street:"Rua Teste",neighborhood:"Centro",city:"SP"},notes:"sem cebola",total_cents:4500}],
 delivery_destinations:[{delivery_order_id:"o1",recipient_name:"Maria Teste",recipient_phone:"(11) 90000-0001",street:"Rua Teste",street_number:"10",latitude:-23.5,longitude:-46.6}],
 reservations:[{id:"r1",customer_id:"c1",customer_name:"Maria Teste",customer_phone:"(11) 90000-0001"}],
 whatsapp_contacts:[{id:"w1",establishment_id:"s1",customer_id:"c1",wa_id:"5511900000001",phone_number:"5511900000001",name:"Maria"}],
 whatsapp_messages:[{id:"m1",establishment_id:"s1",contact_id:"w1",conversation_id:"conv1",content:"oi, sou a Maria",message_timestamp:OLD},{id:"m2",establishment_id:"s1",contact_id:"w1",conversation_id:"conv2",content:"mensagem nova",message_timestamp:new Date().toISOString()}],
 normalized_messages:[{id:"n1",organization_id:"o",customer_id:"c1",conversation_id:"conv1",text_content:"oi de novo",media:[],occurred_at:OLD}],
 voice_call_sessions:[{id:"v1",establishment_id:"s1",customer_id:"c1",source_phone:"5511900000001",customer_name:"Maria",summary:"pediu pizza",started_at:OLD}],
 voice_transcript_segments:[{id:"vt1",call_session_id:"v1",redacted_text:"quero uma pizza"}],
 crm_feedback:[{id:"f1",customer_id:"c1",rating:5,comment:"ótimo"}],customer_journey_enrollments:[{id:"j1",customer_id:"c1",context_snapshot:{name:"Maria"}}],
 fiscal_documents:[{id:"fd1",customer_id:"c1",total_cents:4500}],order_payment_transactions:[{id:"t1",order_id:"o1",pix_key:"chave"}],
 consent_records:[{id:"cr1",context_id:"ctx",customer_id:"c1",subject_ref:"oc1",purpose_key:"marketing_whatsapp",channel:"whatsapp",status:"granted"}],
 analytics_dim_customers:[{customer_key:"k1",customer_id:"c1",pseudonym:"cust_ab12",anonymized_at:null}],analytics_customer_360:[{customer_id:"c1",organization_id:"o",pseudonym:"cust_ab12",order_count:1,revenue_cents:4500}],
 analytics_daily_orders:[{metric_date:"2026-10-01",store_id:"s1",orders_count:1,revenue_cents:4500}],
 marketplace_order_links:[{id:"ml1",internal_order_id:"o1",snapshot_id:"snap1",connection_id:"conn1"}],marketplace_order_snapshots:[{id:"snap1",normalized_snapshot:{customer_name:"Maria Teste",customer_phone:"5511900000001",delivery_address:{street:"Rua Teste"},items:[{name:"X-Burger",qty:1}]}}],
 custom_staff_members:[{id:"st1",establishment_id:"s1",name:"Maria Teste",phone:"(11) 90000-0001",photo_url:PHOTO,notes:"turno noite"},{id:"st9",establishment_id:"x1",name:"Outro"}],
 employee_availability:[{id:"ea1",employee_id:"st1",notes:"só à noite"}],employee_notification_preferences:[{employee_id:"st1",shift_reminders:true}],
 work_shifts:[{id:"ws1",employee_id:"st1",shift_date:"2026-10-01"}],time_clock_entries:[{id:"tc1",employee_id:"st1",occurred_at:OLD,device_id:"dev1"}],
 cash_movements:[{id:"cm1",staff_member_id:"st1",operator_name:"Maria Teste",amount_cents:1000}],
 driver_profiles:[{id:"dp1",custom_staff_member_id:"st1",phone:"5511900000001",vehicle_plate:"ABC1D23",vehicle_model:"Moto",cpf_hash:"h",cpf_last4:"1234"}],
 driver_access_links:[{id:"dal1",driver_profile_id:"dp1",token_hash:"t"}],driver_locations:[{id:"dl1",driver_profile_id:"dp1",latitude:-23.5,longitude:-46.6}],
 deliveries:[{id:"d1",delivered_driver_profile_id:"dp1",delivery_latitude:-23.5,delivery_longitude:-46.6}],driver_financial_entries:[{id:"dfe1",driver_profile_id:"dp1",amount_cents:500,reason:"entrega"}],
 sales_leads:[{id:"l1",contact_name:"Lead Teste",email:"lead@teste.dev",phone:"11999990000",notes:"quer demo",first_touch:{utm:"x"}}],sales_contacts:[{id:"sc1",name:"Lead Teste",email:"lead@teste.dev",phone:"11999990000"}],
 consent_purposes:[],consent_current:[],
});
const ctxOf=(admin,over={})=>({admin,organizationId:"o",contextId:"ctx",storeId:"s1",actorId:"dono",actorType:"user",permissions:[...PRIVACY_PERMISSIONS],flags:Object.fromEntries(PRIVACY_FLAGS.map(f=>[f,true])),...over});
const request=async(admin,type,over={})=>(await createRequest(ctxOf(admin),{type,channel:"customer_portal",customerId:"c1",storeId:"s1",portalSessionVerified:true,...over})).request;
const run=async(admin,req,ctx=ctxOf(admin))=>{const preview=await previewDeletion(ctx,{requestId:req.id});await requestPlanApproval(ctx,{planId:preview.plan.id});await decidePlan({...ctx,actorId:"dpo"},{planId:preview.plan.id,decision:"approved",reason:"Pedido verificado"});return{preview,result:await executePlan({...ctx,actorId:"operador"},{planId:preview.plan.id})}};
const PERSONAL=["Maria","90000-0001","5511900000001","maria@teste.dev","Rua Teste","sem cebola","oi, sou a Maria","pediu pizza","quero uma pizza","só à noite","turno noite","ABC1D23","lead@teste.dev","quer demo"];

test("T01 a subject present in every domain gets a complete preview",async()=>{
 const admin=fakeDb(seed()),customer=await resolveSubject(admin,{contextId:"ctx",organizationId:"o",customerId:"c1"});
 const domains=new Set((await locateSubjectData(admin,customer)).map(x=>x.domain));
 for(const d of["customers","orders","delivery","reservations","whatsapp","voice","customer_experience","journeys","fiscal","financial","consents","data_platform","marketplaces"])assert.ok(domains.has(d),`cliente sem ${d}`);
 const staff=await resolveStaffSubject(admin,{contextId:"ctx",organizationId:"o",staffMemberId:"st1",category:"employee"});
 const staffDomains=new Set((await locateSubjectData(admin,staff)).map(x=>x.domain));
 for(const d of["workforce","drivers","financial","storage"])assert.ok(staffDomains.has(d),`funcionário sem ${d}`);
 const lead=await resolveLeadSubject(admin,{contextId:"plat",leadId:"l1"});
 assert.deepEqual([...new Set((await locateSubjectData(admin,lead)).map(x=>x.domain))],["leads"]);
});
test("T02 execution leaves no personal data outside what the law keeps",async()=>{
 const admin=fakeDb(seed()),req=await request(admin,"deletion"),{result}=await run(admin,req);
 assert.equal(result.status,"partially_completed","marketplace partner is still manual");
 const step=admin.tables.privacy_deletion_steps.find(s=>s.table_name==="marketplace_partner");
 await confirmManualStep(ctxOf(admin,{actorId:"operador"}),{stepId:step.id,note:"Pedido de exclusão enviado ao parceiro, protocolo 123"});
 assert.equal(admin.tables.customer_privacy_requests.find(r=>r.id===req.id).status,"fulfilled");
 const staffReq=await request(admin,"deletion",{customerId:null,subjectCategory:"employee",staffMemberId:"st1"});await run(admin,staffReq);
 const leadAdmin=admin,leadReq=(await createRequest(ctxOf(leadAdmin,{organizationId:null,contextId:"plat"}),{type:"deletion",channel:"email",subjectCategory:"lead",leadId:"l1",portalSessionVerified:false})).request;
 await leadAdmin.from("customer_privacy_requests").update({verification_status:"verified"}).eq("id",leadReq.id);
 await run(leadAdmin,leadReq,ctxOf(leadAdmin,{organizationId:null,contextId:"plat"}));
 const keptByLaw=new Set(ADAPTER_SPECS.filter(s=>s.legalRetention&&!s.personalLinkFields).map(s=>s.table));
 const leftovers=[];for(const[table,rows]of Object.entries(admin.tables)){if(keptByLaw.has(table)||/^privacy_|consent_|security_audit|automation_event/.test(table))continue;const text=JSON.stringify(rows.filter(r=>!["x1","other","st9"].some(id=>JSON.stringify(r).includes(`"${id}"`))));for(const v of PERSONAL)if(text.includes(v))leftovers.push(`${table}:${v}`)}
 assert.deepEqual(leftovers,[],"nothing personal survives");
});
test("T03 labor and financial records of employee and driver stay, with the link pseudonymized",async()=>{
 const admin=fakeDb(seed()),req=await request(admin,"deletion",{customerId:null,subjectCategory:"driver",staffMemberId:"st1"});const{preview}=await run(admin,req);
 const by=Object.fromEntries(preview.domains.map(d=>[d.domain,d]));assert.ok(by.workforce.retain>=2&&by.financial.retain>=1&&by.drivers.retain>=1);
 assert.equal(admin.tables.work_shifts.length,1);assert.equal(admin.tables.time_clock_entries.length,1);assert.equal(admin.tables.driver_financial_entries.length,1);assert.equal(admin.tables.deliveries.length,1);
 assert.equal(admin.tables.cash_movements[0].operator_name,"Operador anonimizado");assert.equal(admin.tables.cash_movements[0].amount_cents,1000);
 assert.equal(admin.tables.custom_staff_members.find(x=>x.id==="st1").name,"Funcionário anonimizado");assert.match(admin.tables.driver_profiles[0].phone,/^psd_/);
 assert.equal(admin.tables.driver_locations.length,0);assert.equal(admin.tables.employee_availability.length,0);
});
test("T04 Data Platform keeps no personal data and keeps the aggregates",async()=>{
 const admin=fakeDb(seed()),req=await request(admin,"deletion");await run(admin,req);
 assert.ok(admin.tables.analytics_dim_customers[0].anonymized_at);assert.equal(admin.tables.analytics_customer_360.length,0);
 assert.deepEqual(admin.tables.analytics_daily_orders[0],{metric_date:"2026-10-01",store_id:"s1",orders_count:1,revenue_cents:4500});
 assert.deepEqual(admin.tables.marketplace_order_snapshots[0].normalized_snapshot,{items:[{name:"X-Burger",qty:1}]});
});
test("T05 Storage: files go with a record and no content; files under hold stay",async()=>{
 const admin=fakeDb(seed()),req=await request(admin,"deletion",{customerId:null,subjectCategory:"employee",staffMemberId:"st1"});await run(admin,req);
 assert.deepEqual(admin.removed,["product-images/s1/team/employee-1.jpg"]);assert.equal(admin.tables.custom_staff_members.find(x=>x.id==="st1").photo_url,null);
 const step=admin.tables.privacy_deletion_steps.find(s=>s.table_name==="storage:staff_photos");assert.match(step.evidence.path_sha256,/^[0-9a-f]{64}$/);
 assert.ok(!JSON.stringify([admin.tables.privacy_deletion_steps,admin.tables.privacy_audit_events]).includes("employee-1.jpg"),"no path in the record");
 const held=fakeDb({...seed(),legal_holds:[{context_id:"ctx",scope_type:"dataset",domain:"storage",reason:"litigation",status:"active"}]}),req2=await request(held,"deletion",{customerId:null,subjectCategory:"employee",staffMemberId:"st1"});await run(held,req2);
 assert.deepEqual(held.removed,[]);assert.equal(held.tables.custom_staff_members.find(x=>x.id==="st1").photo_url,PHOTO);
});
test("T06 a marketplace without an erasure API keeps the request partial until confirmed",async()=>{
 const admin=fakeDb(seed()),req=await request(admin,"deletion"),{result}=await run(admin,req);
 assert.ok(result.open_domains.includes("marketplaces"));assert.equal(admin.tables.customer_privacy_requests.find(r=>r.id===req.id).status,"partially_fulfilled");
});
const deadlinePolicy=days=>({...privacyPolicyTemplates({dsr_deadline_days:{default:15,access:days},dsr_alert_days_before:3})[0],status:"active"});
test("T07 Phase 79 policies apply, and without one the Phase 95 values do",async()=>{
 const plain=fakeDb(seed()),a=await request(plain,"access");assert.equal(Math.round((Date.parse(a.due_at)-Date.parse(a.received_at))/864e5),15);
 const governed=fakeDb({...seed(),policy_active_documents:[{organization_id:"o",policy_key:PRIVACY_POLICY_KEYS.dsrDeadline,document:deadlinePolicy(5)}]}),b=await request(governed,"access"),c=await request(governed,"deletion");
 assert.equal(Math.round((Date.parse(b.due_at)-Date.parse(b.received_at))/864e5),5);assert.equal(Math.round((Date.parse(c.due_at)-Date.parse(c.received_at))/864e5),15);
 const impact=await previewDeadlineImpact(ctxOf(plain),deadlinePolicy(5));assert.equal(impact.changed,1);assert.equal(impact.earlier,1);
 const broken=fakeDb(seed(),{missing:["policy_active_documents"]}),d=await request(broken,"access");assert.equal(Math.round((Date.parse(d.due_at)-Date.parse(d.received_at))/864e5),15,"policy store down: settings apply");
});
test("T08 approver, requester and executor are different people",async()=>{
 const admin=fakeDb(seed()),req=await request(admin,"anonymization"),ctx=ctxOf(admin),preview=await previewDeletion(ctx,{requestId:req.id});await requestPlanApproval(ctx,{planId:preview.plan.id});
 await assert.rejects(decidePlan(ctx,{planId:preview.plan.id,decision:"approved",reason:"eu mesmo"}),/SELF_APPROVAL_BLOCKED/);
 await decidePlan(ctxOf(admin,{actorId:"dpo"}),{planId:preview.plan.id,decision:"approved",reason:"Aprovado no teste"});
 await assert.rejects(executePlan(ctxOf(admin,{actorId:"dpo"}),{planId:preview.plan.id}),/EXECUTOR_IS_APPROVER/);
 await assert.rejects(executePlan(ctx,{planId:preview.plan.id}),/EXECUTOR_IS_REQUESTER/);
 assert.ok((await executePlan(ctxOf(admin,{actorId:"operador"}),{planId:preview.plan.id})).status);
 const two=fakeDb({...seed(),policy_active_documents:[{organization_id:"o",policy_key:PRIVACY_POLICY_KEYS.deletionApproval,document:{...privacyPolicyTemplates({dsr_deadline_days:{default:15},dsr_alert_days_before:3})[2],status:"active",rules:[{...privacyPolicyTemplates({dsr_deadline_days:{default:15},dsr_alert_days_before:3})[2].rules[0],obligations:[{type:"approval",metadata:{requiredApprovals:2}}]}]}}]});
 const r2=await request(two,"deletion"),p2=await previewDeletion(ctxOf(two),{requestId:r2.id});await requestPlanApproval(ctxOf(two),{planId:p2.plan.id});
 assert.equal((await decidePlan(ctxOf(two,{actorId:"dpo"}),{planId:p2.plan.id,decision:"approved",reason:"primeira"})).status,"awaiting_approval");
 await assert.rejects(decidePlan(ctxOf(two,{actorId:"dpo"}),{planId:p2.plan.id,decision:"approved",reason:"de novo"}),/ALREADY_DECIDED/);
 assert.equal((await decidePlan(ctxOf(two,{actorId:"juridico"}),{planId:p2.plan.id,decision:"approved",reason:"segunda"})).status,"approved");
});
test("T09 ActionEngine decision is documented and nothing stores content",async()=>{
 assert.equal(PRIVACY_ACTION_ENGINE_DECISION.engine,"internal_approvals");assert.match(PRIVACY_ACTION_ENGINE_DECISION.reason,/before_state/);
 const dir=new URL("../lib/privacy-operations/",import.meta.url),sources=(await Promise.all((await readdir(dir)).map(x=>readFile(new URL(x,dir),"utf8")))).join("\n");
 assert.doesNotMatch(sources,/from\("copilot_action_requests"\)/);
 const admin=fakeDb(seed()),req=await request(admin,"deletion");await run(admin,req);
 const trail=JSON.stringify([admin.tables.privacy_deletion_steps,admin.tables.privacy_audit_events,admin.tables.internal_approvals,admin.tables.privacy_dsr_events]);for(const v of PERSONAL)assert.ok(!trail.includes(v),`trail leaked ${v}`);
});
test("T10 no browser prompt or confirm left in the privacy screens",async()=>{
 const sources=await Promise.all(["../components/privacy-operations-center.tsx","../components/privacy-portal-center.tsx","../components/privacy-decision-dialog.tsx"].map(file));
 for(const s of sources)assert.doesNotMatch(s,/window\.(prompt|confirm|alert)|\bprompt\(|\bconfirm\(/);
 assert.match(sources[2],/role="dialog"/);assert.match(sources[2],/aria-modal="true"/);assert.match(sources[2],/Escape/);assert.match(sources[0],/confirmPhrase:total>=20\?"EXCLUIR"/);
});
const msgPolicy=(dataset)=>({id:"pol",context_id:"ctx",name:"Retenção",domain:dataset==="messages"?"whatsapp":"voice",dataset,period_days:180,trigger:"after_created",action:"anonymize",requires_approval:true,status:"active"});
test("T11 message and voice retention in simulation changes no data",async()=>{
 for(const dataset of["messages","voice_calls"]){const admin=fakeDb({...seed(),retention_policies:[msgPolicy(dataset)]}),before=JSON.stringify([admin.tables.whatsapp_messages,admin.tables.normalized_messages,admin.tables.voice_call_sessions,admin.tables.voice_transcript_segments]);
  const{report}=await runRetention(ctxOf(admin),{policyId:"pol",mode:"dry_run"});assert.equal(report.due,dataset==="messages"?2:1,dataset);
  assert.equal(JSON.stringify([admin.tables.whatsapp_messages,admin.tables.normalized_messages,admin.tables.voice_call_sessions,admin.tables.voice_transcript_segments]),before)}
});
test("T12 real message and voice retention needs the flag and an approval",async()=>{
 const admin=fakeDb({...seed(),retention_policies:[msgPolicy("messages")],legal_holds:[{context_id:"ctx",scope_type:"case",scope_ref:"conv2",reason:"litigation",status:"active"}]});
 await assert.rejects(runRetention(ctxOf(admin,{flags:{privacy_retention_execution_enabled:false}}),{policyId:"pol",mode:"execute"}),/RETENTION_EXECUTION_DISABLED/);
 const{run:pending}=await requestRetentionRun(ctxOf(admin),{policyId:"pol"});
 await assert.rejects(runRetention(ctxOf(admin,{actorId:"operador"}),{policyId:"pol",mode:"execute",runId:pending.id}),/APPROVAL_REQUIRED/);
 await decideRetentionRun(ctxOf(admin,{actorId:"dpo"}),{runId:pending.id,decision:"approved",reason:"Prazo validado"});
 admin.tables.internal_approvals.find(a=>a.id===pending.approval_id).approver_user_id="dpo";
 const{report}=await runRetention(ctxOf(admin,{actorId:"operador"}),{policyId:"pol",mode:"execute",runId:pending.id});
 assert.equal(report.processed,2);assert.equal(admin.tables.whatsapp_messages.find(m=>m.id==="m1").content,"[removido pela política de retenção]");
 assert.equal(admin.tables.whatsapp_messages.length,2,"rows stay for the counts");
 const voice=fakeDb({...seed(),retention_policies:[msgPolicy("voice_calls")]}),{run:vr}=await requestRetentionRun(ctxOf(voice),{policyId:"pol"});await decideRetentionRun(ctxOf(voice,{actorId:"dpo"}),{runId:vr.id,decision:"approved",reason:"Prazo validado"});
 await runRetention(ctxOf(voice,{actorId:"operador"}),{policyId:"pol",mode:"execute",runId:vr.id});
 const call=voice.tables.voice_call_sessions[0];assert.match(call.source_phone,/^psd_/);assert.equal(call.customer_name,null);assert.equal(voice.tables.voice_transcript_segments[0].redacted_text,"[removido pela política de retenção]");
});
test("T13 the go-live checklist blocks activation with a critical item pending",async()=>{
 const items=[{key:"dpo",label:"DPO",critical:true,ok:false,detail:""},{key:"subs",label:"Sub",critical:false,ok:false,detail:""}];
 assert.equal(goLiveGate(items,{isDpo:false}).reason,"GO_LIVE_BLOCKED");assert.equal(goLiveGate(items,{override:true,isDpo:false,reason:"x".repeat(30)}).reason,"FORBIDDEN");
 assert.equal(goLiveGate(items,{override:true,isDpo:true,reason:"curto"}).reason,"REASON_REQUIRED");assert.equal(goLiveGate(items,{override:true,isDpo:true,reason:"Piloto acompanhado pelo encarregado nesta semana"}).allowed,true);
 assert.equal(goLiveGate([{...items[1]}],{isDpo:false}).allowed,true,"non-critical items do not block");
 const admin=fakeDb({...seed(),store_feature_flags:[{establishment_id:"s1",privacy_operations_enabled:false}]},{goLiveTrigger:true});
 await assert.rejects(enableStore(ctxOf(admin,{permissions:["privacy:manage_governance"]}),{}),/GO_LIVE_BLOCKED/);
 assert.equal(admin.tables.store_feature_flags[0].privacy_operations_enabled,false);
 await enableStore(ctxOf(admin),{override:true,reason:"Piloto acompanhado pelo encarregado nesta semana"});assert.equal(admin.tables.store_feature_flags[0].privacy_operations_enabled,true);
 const s=await migrations();assert.match(s,/raise exception 'PRIVACY_GO_LIVE_REQUIRED'/);assert.match(s,/before update of privacy_operations_enabled on public\.store_feature_flags/);
});
test("T14 production without the new migrations answers in a controlled way",async()=>{
 assert.equal(isNotInstalled({code:"42703",message:"column store_feature_flags.privacy_setup_enabled does not exist"}),true);
 const route=await file("../app/api/privacy/route.ts");assert.match(route,/PRIVACY_NOT_INSTALLED"},503\)/);
 const worker=await file("../app/api/privacy/worker/route.ts");assert.match(worker,/503/);
 assert.equal((await migrations()).match(/privacy_setup_enabled boolean not null default false/g).length,2,"new flag off in plans and stores");
});
test("T15 tenant isolation and RLS",async()=>{
 const s=await migrations();for(const t of[...s.matchAll(/create table public\.(\w+)\(/g)].map(m=>m[1]))assert.match(s,new RegExp(`alter table public\\.${t} enable row level security`));
 assert.doesNotMatch(s,/to authenticated/);
 const admin=fakeDb(seed());assert.equal(await resolveStaffSubject(admin,{contextId:"ctx",organizationId:"o",staffMemberId:"st9",category:"employee"}),null);
 await assert.rejects(createRequest(ctxOf(admin),{type:"deletion",channel:"email",subjectCategory:"lead",leadId:"l1"}),/PLATFORM_CONTEXT_REQUIRED/,"a tenant never reaches SaaS leads");
});
test("T16 RBAC stays governed by Identity Governance",async()=>{
 const catalog=new AccessCatalogService().compose({modulePermissions:{soc:[],vendor:[],idgov:[],privacy:PRIVACY_PERMISSIONS},apiScopes:[]});assert.equal(catalog.find(x=>x.key==="perm:privacy:dpo").criticality,"critical");
 const route=await file("../app/api/privacy/route.ts");assert.match(route,/case"enable_store":need\(ctx,"privacy:manage_governance"\)/);assert.match(route,/case"disable_store":need\(ctx,"privacy:manage_governance"\)/);
});
test("T17 a module failure does not block orders",async()=>{
 const admin=fakeDb(seed(),{missing:["store_feature_flags"]});assert.equal((await marketingConsentGate(admin,{storeId:"s1",customerId:"c1",purposeKey:"marketing_whatsapp",channel:"whatsapp"})).mode,"legacy");
 for(const p of["../app/api/public-orders/route.ts","../app/api/stripe/checkout/route.ts","../app/api/security/login/route.ts"])assert.doesNotMatch(await file(p).catch(()=>""),/privacy-operations/);
});
