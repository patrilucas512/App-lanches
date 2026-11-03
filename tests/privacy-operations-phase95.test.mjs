import test from"node:test";import assert from"node:assert/strict";import{readFile,readdir}from"node:fs/promises";
import{PRIVACY_FLAGS,PRIVACY_PERMISSIONS,PrivacyAccessService,anonymizeValue,canSeeContext,consentDecision,detectPersonalColumns,dsrAlert,dsrDueAt,planDeletion,reidentificationRisks,retentionRunGate,unmappedPersonalColumns,verificationRequirement}from"../lib/privacy-operations/core.ts";
import{ADAPTER_SPECS,IMPLEMENTED_DOMAINS,contextSalt,executeStep,locateSubjectData,resolveSubject}from"../lib/privacy-operations/adapters.ts";
import{canonicalAllowedSet,marketingConsentGate,recordConsent}from"../lib/privacy-operations/consents.ts";
import{approveResponse,confirmVerification,createRequest,generateAccessPackage,loadRequest,saveResponseDraft,scanDeadlines,startVerification,transitionRequest}from"../lib/privacy-operations/dsr.ts";
import{decidePlan,executePlan,previewDeletion,requestPlanApproval}from"../lib/privacy-operations/deletion.ts";
import{createHold,runRetention}from"../lib/privacy-operations/retention.ts";
import{decideIncidentNotification}from"../lib/privacy-operations/governance.ts";
import{PRIVACY_COPILOT_TOOLS,privacyCopilot}from"../lib/privacy-operations/integrations.ts";
import{isNotInstalled}from"../lib/privacy-operations/server.ts";
import{AccessCatalogService}from"../lib/identity-governance/core.ts";
const file=p=>readFile(new URL(p,import.meta.url),"utf8");
const migrations=async()=>{const dir=new URL("../supabase/migrations/",import.meta.url),names=(await readdir(dir)).filter(x=>x.includes("_phase95")).sort();return(await Promise.all(names.map(x=>readFile(new URL(x,dir),"utf8")))).join("\n")};

// In-memory stand-in for the Supabase client: enough of the query builder, RPC and Storage to run the services for real.
function fakeDb(seed={},options={}){const tables=Object.fromEntries(Object.entries(seed).map(([k,v])=>[k,v.map(x=>({...x}))]));let serial=0;const files=new Map();
 const db={tables,files,
 rpc:async(name,args)=>{if(options.rpc?.[name])return options.rpc[name](args,db);return{data:null,error:{message:`rpc ${name} not faked`}}},
 storage:{from:()=>({upload:async(path,body)=>{files.set(path,await body.text());return{data:{path},error:null}},createSignedUrl:async path=>({data:{signedUrl:`https://signed.test/${path}`},error:null})})},
 from(table){tables[table]||=[];const q={op:"select",filters:[],row:null,opts:{},head:false,rangeFrom:null,rangeTo:null,
  select(_c,o){if(q.op==="select"&&o?.head)q.head=true;return q},eq(k,v){q.filters.push(x=>x[k]===v);return q},neq(k,v){q.filters.push(x=>x[k]!==v);return q},in(k,v){q.filters.push(x=>v.includes(x[k]));return q},is(k,v){q.filters.push(x=>(x[k]??null)===v);return q},gte(k,v){q.filters.push(x=>x[k]>=v);return q},gt(k,v){q.filters.push(x=>x[k]>v);return q},lte(k,v){q.filters.push(x=>x[k]<=v);return q},lt(k,v){q.filters.push(x=>x[k]!=null&&x[k]<v);return q},like(k,v){const re=new RegExp("^"+v.replace(/%/g,".*")+"$");q.filters.push(x=>re.test(String(x[k])));return q},
  not(k,op,v){q.filters.push(x=>op==="is"?(x[k]??null)!==v:!String(v).replace(/[()]/g,"").split(",").includes(String(x[k])));return q},or(){return q},order(){return q},limit(){return q},range(a,b){q.rangeFrom=a;q.rangeTo=b;return q},
  insert(row){q.op="insert";q.row=row;return q},update(row){q.op="update";q.row=row;return q},upsert(row,o){q.op="upsert";q.row=row;q.opts=o||{};return q},delete(){q.op="delete";return q},
  run(){const fail=options.fail?.({table,op:q.op,row:q.row});if(fail)return{data:null,error:fail};if(options.unavailable?.includes(table))return{data:null,error:{code:"57014",message:"canceling statement due to statement timeout"}};if(options.missing?.includes(table))return{data:null,error:{code:"PGRST205",message:`Could not find the table 'public.${table}' in the schema cache`}};
   let match=tables[table].filter(x=>q.filters.every(f=>f(x)));
   if(q.op==="select"){const count=match.length;if(q.rangeFrom!=null)match=match.slice(q.rangeFrom,q.rangeTo+1);return{data:match.map(x=>({...x})),count,error:null}}
   if(q.op==="insert"){const rows=(Array.isArray(q.row)?q.row:[q.row]).map(x=>({id:`${table}-${++serial}`,created_at:new Date(Date.UTC(2026,10,1,0,0,serial)).toISOString(),...x}));
    if(table==="customer_privacy_requests")rows.forEach(r=>{r.status||="received";r.received_at||=r.created_at;r.outcome||={}});
    if(table==="privacy_deletion_steps")rows.forEach(r=>{r.attempts??=0});
    if(table==="privacy_deletion_plans")rows.forEach(r=>{r.status||="previewed"});
    if(table==="legal_holds")rows.forEach(r=>{r.status||="active"});
    tables[table].push(...rows);return{data:rows.map(x=>({...x})),error:null}}
   if(q.op==="update"){match.forEach(x=>Object.assign(x,q.row));return{data:match.map(x=>({...x})),error:null}}
   if(q.op==="delete"){tables[table]=tables[table].filter(x=>!match.includes(x));return{data:match,error:null}}
   const keys=String(q.opts.onConflict||"id").split(","),rows=Array.isArray(q.row)?q.row:[q.row],out=[];for(const row of rows){const existing=tables[table].find(x=>keys.every(k=>x[k]===row[k]));if(existing){if(!q.opts.ignoreDuplicates)Object.assign(existing,row);out.push(existing)}else{const created={id:row.id||`${table}-${++serial}`,...row};tables[table].push(created);out.push(created)}}return{data:out,error:null}},
  single(){const r=q.run();return Promise.resolve({data:r.data?.[0]??null,error:r.error||(r.data?.length?null:{message:"no rows"})})},maybeSingle(){const r=q.run();return Promise.resolve({data:r.data?.[0]??null,error:r.error})},then(ok,no){const r=q.run();return Promise.resolve(q.head?{count:r.count,data:null,error:r.error}:r).then(ok,no)}};return q}};return db}

// Fictitious data only: one titular in organization "o", one intruder in organization "other".
const seed=()=>({
 establishments:[{id:"s1",organization_id:"o",name:"Loja Teste"},{id:"x1",organization_id:"other",name:"Outra"}],
 store_feature_flags:[{establishment_id:"s1",privacy_operations_enabled:true}],
 privacy_contexts:[{id:"ctx",organization_id:"o",kind:"tenant_controller"},{id:"ctx2",organization_id:"other",kind:"tenant_controller"},{id:"plat",organization_id:null,kind:"platform_controller"}],
 organization_customers:[{id:"oc1",organization_id:"o",name:"Maria Teste",normalized_phone:"5511900000001",email:"maria@teste.dev"},{id:"oc9",organization_id:"other",name:"Outra Pessoa",normalized_phone:"5511900000009"}],
 customers:[{id:"c1",establishment_id:"s1",organization_customer_id:"oc1",name:"Maria Teste",phone:"(11) 90000-0001",email:"maria@teste.dev",birth_date:"1990-01-01",crm_notes:"gosta de picles",normalized_phone:"5511900000001",marketing_status:"opted_in",establishments:{organization_id:"o"}},{id:"c9",establishment_id:"x1",organization_customer_id:"oc9",name:"Outra Pessoa",phone:"(11) 90000-0009",establishments:{organization_id:"other"}}],
 customer_addresses:[{id:"a1",organization_id:"o",customer_id:"c1",organization_customer_id:"oc1",street:"Rua Teste",number:"10",neighborhood:"Centro"}],
 customer360_notes:[{id:"n1",organization_id:"o",customer_id:"c1",content:"nota"}],customer360_preferences:[{id:"p1",organization_id:"o",customer_id:"c1",preference_type:"dietary",value:"alergia a amendoim"}],
 orders:[{id:"o1",establishment_id:"s1",customer_id:"c1",customer_name:"Maria Teste",customer_phone:"(11) 90000-0001",delivery_address:{street:"Rua Teste",number:"10",neighborhood:"Centro",city:"São Paulo"},notes:"sem cebola",total_cents:4500,status:"completed"},{id:"o2",establishment_id:"s1",customer_id:"c1",customer_name:"Maria Teste",customer_phone:"(11) 90000-0001",delivery_address:null,total_cents:2000,status:"completed"},{id:"o9",establishment_id:"x1",customer_id:"c9",customer_name:"Outra Pessoa",total_cents:999}],
 delivery_destinations:[{delivery_order_id:"o1",recipient_name:"Maria Teste",recipient_phone:"(11) 90000-0001",street:"Rua Teste",street_number:"10",neighborhood:"Centro",latitude:-23.5,longitude:-46.6}],
 reservations:[{id:"r1",customer_id:"c1",organization_customer_id:"oc1",customer_name:"Maria Teste",customer_phone:"(11) 90000-0001",party_size:2}],waitlist_entries:[],
 whatsapp_contacts:[{id:"w1",establishment_id:"s1",customer_id:"c1",wa_id:"5511900000001",phone_number:"5511900000001",name:"Maria",profile_name:"Maria"}],
 whatsapp_messages:[{id:"m1",contact_id:"w1",content:"quero um x-burger",direction:"inbound"}],
 voice_call_sessions:[{id:"v1",customer_id:"c1",source_phone:"5511900000001",customer_name:"Maria",summary:"pedido por voz"}],
 crm_feedback:[{id:"f1",customer_id:"c1",rating:5,comment:"ótimo, Maria"}],customer_journey_enrollments:[{id:"j1",customer_id:"c1",context_snapshot:{name:"Maria"},status:"active"}],
 fiscal_documents:[{id:"fd1",customer_id:"c1",document_type:"nfce",document_number:"123",total_cents:4500}],
 order_payment_transactions:[{id:"t1",order_id:"o1",pix_key:"chave-teste",status:"paid"}],
 consent_records:[{id:"cr0",context_id:"ctx",customer_id:"c1",subject_ref:"oc1",purpose_key:"marketing_whatsapp",channel:"whatsapp",status:"granted",recorded_at:"2026-10-01T00:00:00Z"}],
 consent_current:[],consent_purposes:[{context_id:"ctx",purpose_key:"marketing_whatsapp",current_version:1,requires_reacceptance:false,active:true,channels:["whatsapp"]}],
});
const ctxOf=(admin,over={})=>({admin,organizationId:"o",contextId:"ctx",storeId:"s1",actorId:"dono",actorType:"user",permissions:[...PRIVACY_PERMISSIONS],flags:Object.fromEntries(PRIVACY_FLAGS.map(f=>[f,true])),...over});
const verifiedRequest=async(admin,type)=>{const{request}=await createRequest(ctxOf(admin),{type,channel:"customer_portal",customerId:"c1",storeId:"s1",portalSessionVerified:true});return request};
const fakeRecordConsent=(args,db)=>{const row={id:`cr-${db.tables.consent_records.length+1}`,context_id:args.requested_context_id,customer_id:args.requested_customer_id,subject_ref:args.requested_subject_ref,purpose_key:args.requested_purpose,channel:args.requested_channel,status:args.requested_status,recorded_at:new Date(Date.now()+db.tables.consent_records.length*1000).toISOString()};db.tables.consent_records.push(row);if(args.requested_purpose==="marketing_whatsapp")db.tables.customers.filter(c=>c.id===args.requested_customer_id).forEach(c=>c.marketing_status=args.requested_status==="granted"?"opted_in":"opted_out");return{data:row.id,error:null}};

test("T01 controller context separates the tenant and MasterApp",async()=>{
 assert.equal(canSeeContext({kind:"tenant_controller",organization_id:"o"},{organizationId:"o"}),true);
 assert.equal(canSeeContext({kind:"platform_controller",organization_id:null},{organizationId:"o"}),false);
 assert.equal(canSeeContext({kind:"platform_controller",organization_id:null},{organizationId:"o",superadmin:true}),true);
 const s=await migrations();
 assert.match(s,/check\(\(kind='tenant_controller'\)=\(organization_id is not null\)\)/);
 assert.match(s,/insert into public\.privacy_contexts\(kind,name\) values\('platform_controller'/);
});
test("T02 a tenant's DPO does not see another tenant",async()=>{
 assert.equal(canSeeContext({kind:"tenant_controller",organization_id:"other"},{organizationId:"o"}),false);
 const admin=fakeDb({...seed(),customer_privacy_requests:[{id:"req-other",context_id:"ctx2",request_type:"access",status:"received"}]});
 await assert.rejects(loadRequest(ctxOf(admin),"req-other"),/REQUEST_NOT_FOUND/);
 assert.equal(await resolveSubject(admin,{contextId:"ctx",organizationId:"o",customerId:"c9"}),null);
});
test("T03 the data map finds the test subject in every domain",async()=>{
 const admin=fakeDb(seed()),subject=await resolveSubject(admin,{contextId:"ctx",organizationId:"o",customerId:"c1"});
 assert.deepEqual(subject.customerIds,["c1"]);assert.equal(subject.subjectRef,"oc1");
 const found=await locateSubjectData(admin,subject),domains=new Set(found.map(x=>x.domain));
 for(const d of["customers","orders","delivery","reservations","whatsapp","voice","customer_experience","journeys","fiscal","financial","consents"])assert.ok(domains.has(d),`domínio ${d}`);
 // Since Phase 96 every domain has an adapter; a customer without marketplace orders has no manual step left.
 assert.ok(!found.some(x=>x.adapterStatus==="pending"),"no manual step for this subject");
 assert.ok(!found.some(x=>x.recordId==="o9"),"never the other tenant's order");
});
test("T04 canonical consent is read by Marketing, Journeys, CX and WhatsApp",async()=>{
 const[mkt,journeys,cx,s]=await Promise.all([file("../app/api/marketing-intelligence/route.ts"),file("../app/api/customer-journeys/worker/route.ts"),file("../lib/customer-experience/surveys.ts"),migrations()]);
 assert.match(mkt,/canonicalAllowedSet\(a,/);assert.match(journeys,/await canonicalAllows\(a,/);assert.match(cx,/marketingConsentGate\(admin,/);
 // WhatsApp campaigns and outbox read customers/whatsapp_contacts in SQL; the canonical write updates both in the same transaction.
 assert.match(s,/update public\.whatsapp_contacts set marketing_status=legacy,marketing_consent_at=now\(\),marketing_opt_out=\(legacy='opted_out'\)/);
 assert.match(s,/create trigger crm_consent_events_privacy_mirror after insert on public\.crm_consent_events/);
 const admin=fakeDb(seed());
 const set=await canonicalAllowedSet(admin,{storeId:"s1",customerIds:["c1"],purposeKey:"marketing_whatsapp",channel:"whatsapp"});
 assert.ok(set instanceof Set);
});
test("T05 revocation blocks new sends immediately",async()=>{
 const admin=fakeDb(seed(),{rpc:{privacy_record_consent:fakeRecordConsent}}),ctx=ctxOf(admin);
 assert.equal((await marketingConsentGate(admin,{storeId:"s1",customerId:"c1",purposeKey:"marketing_whatsapp",channel:"whatsapp"})).allowed,true);
 await recordConsent(ctx,{customerId:"c1",subjectRef:"oc1",storeId:"s1",purposeKey:"marketing_whatsapp",channel:"whatsapp",status:"revoked",origin:"test"});
 const gate=await marketingConsentGate(admin,{storeId:"s1",customerId:"c1",purposeKey:"marketing_whatsapp",channel:"whatsapp"});
 assert.equal(gate.allowed,false);assert.equal(gate.reason,"REVOKED");
 assert.equal(admin.tables.customers.find(c=>c.id==="c1").marketing_status,"opted_out","legacy senders see it too");
 assert.ok(admin.tables.privacy_audit_events.some(e=>e.action==="consent_revoked"));
});
test("T06 registry unavailable: marketing does not go out, transactional does",async()=>{
 const admin=fakeDb(seed(),{unavailable:["consent_records"]});
 const marketing=await marketingConsentGate(admin,{storeId:"s1",customerId:"c1",purposeKey:"marketing_whatsapp",channel:"whatsapp"});
 assert.deepEqual([marketing.allowed,marketing.reason],[false,"REGISTRY_UNAVAILABLE"]);
 const transactional=await marketingConsentGate(admin,{storeId:"s1",customerId:"c1",purposeKey:"order_update",channel:"whatsapp",kind:"transactional"});
 assert.equal(transactional.allowed,true);
 assert.equal(consentDecision({kind:"marketing",purpose:"x",channel:"whatsapp",records:null,registryAvailable:false,now:new Date()}).allowed,false);
});
test("T07 an access request produces the subject's complete package",async()=>{
 const admin=fakeDb(seed()),ctx=ctxOf(admin),request=await verifiedRequest(admin,"access");
 const{package:pack}=await generateAccessPackage(ctx,{id:request.id});
 const body=JSON.parse([...admin.files.values()][0]);
 for(const d of["customers","orders","reservations","whatsapp","fiscal"])assert.ok(body.domains[d],`pacote sem ${d}`);
 assert.deepEqual(pack.missing_domains,[],"nothing is left out of the package");
 assert.ok(!JSON.stringify(body).includes("Outra Pessoa"),"no other subject in the package");
 const audit=admin.tables.privacy_audit_events.find(e=>e.action==="access_package_generated");
 assert.ok(audit.metadata.sha256&&!JSON.stringify(audit).includes("Maria"));
});
test("T08 deletion preview says what is deleted, anonymized and kept",async()=>{
 const admin=fakeDb(seed()),ctx=ctxOf(admin),request=await verifiedRequest(admin,"deletion");
 const preview=await previewDeletion(ctx,{requestId:request.id}),by=Object.fromEntries(preview.domains.map(d=>[d.domain,d]));
 assert.equal(by.customers.delete,3,"addresses, notes and preferences are deleted");
 assert.equal(by.customers.anonymize,2,"customer records stay anonymous for orders");
 assert.equal(by.orders.anonymize,2);assert.equal(by.orders.delete,0);
 assert.equal(by.fiscal.anonymize,1);assert.match(by.fiscal.reasons.join(),/legal_retention:fiscal/);
 assert.equal(by.financial.retain,1);assert.ok(!preview.domains.some(d=>d.manual>0),"no manual step");
 assert.equal(admin.tables.customers.find(c=>c.id==="c1").name,"Maria Teste","a preview changes nothing");
});
const approveAndRun=async(admin,request,over={})=>{const ctx=ctxOf(admin,over),preview=await previewDeletion(ctx,{requestId:request.id});await requestPlanApproval(ctx,{planId:preview.plan.id});await decidePlan(ctxOf(admin,{actorId:"dpo"}),{planId:preview.plan.id,decision:"approved",reason:"Pedido verificado"});return{plan:preview.plan,result:await executePlan(ctxOf(admin,{actorId:"operador"}),{planId:preview.plan.id})}};
test("T09 fiscal and financial records stay, with the personal link anonymized",async()=>{
 const admin=fakeDb(seed()),request=await verifiedRequest(admin,"deletion");await approveAndRun(admin,request);
 const fiscal=admin.tables.fiscal_documents.find(x=>x.id==="fd1");assert.ok(fiscal);assert.equal(fiscal.customer_id,null);assert.equal(fiscal.total_cents,4500);
 assert.equal(admin.tables.order_payment_transactions.length,1);
 const customer=admin.tables.customers.find(c=>c.id==="c1");assert.equal(customer.name,"Cliente anonimizado");assert.match(customer.phone,/^psd_/);assert.equal(customer.email,null);
 assert.equal(admin.tables.customer_addresses.length,0);
});
test("T10 a legal hold prevents deletion",async()=>{
 const admin=fakeDb(seed()),ctx=ctxOf(admin);await createHold(ctx,{scope_type:"subject",scope_ref:"oc1",reason:"litigation",basis:"Processo judicial em andamento"});
 const request=await verifiedRequest(admin,"deletion"),{result}=await approveAndRun(admin,request);
 assert.equal(admin.tables.customers.find(c=>c.id==="c1").name,"Maria Teste");
 assert.equal(admin.tables.customer_addresses.length,1);
 assert.ok(result.retained_domains.includes("customers"));
 assert.ok(planDeletion({records:[{domain:"orders",table:"orders",recordId:"o1",categories:[]}],holds:[{scope_type:"subject",scope_ref:"oc1",status:"active",reason:"fiscal"}],subjectRef:"oc1",mode:"deletion",now:new Date()}).every(x=>x.decision==="retain"));
});
test("T11 a failure in one domain leaves the request partial, never complete",async()=>{
 const admin=fakeDb(seed(),{fail:({table,op})=>table==="reservations"&&op==="update"?{message:"timeout"}:null}),request=await verifiedRequest(admin,"deletion");
 const{result}=await approveAndRun(admin,request);
 assert.equal(result.status,"partially_completed");
 const saved=admin.tables.customer_privacy_requests.find(r=>r.id===request.id);
 assert.equal(saved.status,"partially_fulfilled");assert.match(saved.rejection_reason,/reservations/);
});
test("T12 deletion is idempotent and resumable",async()=>{
 let failing=true;const admin=fakeDb(seed(),{fail:({table,op})=>failing&&table==="whatsapp_messages"&&op==="update"?{message:"transient"}:null});
 const request=await verifiedRequest(admin,"anonymization"),{plan,result}=await approveAndRun(admin,request);
 assert.ok(result.open_domains.includes("whatsapp"));
 failing=false;const again=await executePlan(ctxOf(admin,{actorId:"operador"}),{planId:plan.id});
 assert.ok(!again.open_domains.includes("whatsapp"),"resumed and finished");
 // Running every step again changes nothing: each one converges to the same state.
 const snapshot=JSON.stringify([admin.tables.customers,admin.tables.orders,admin.tables.whatsapp_messages]),salt=await contextSalt(admin,"ctx");
 for(const step of admin.tables.privacy_deletion_steps.filter(x=>x.plan_id===plan.id&&x.decision!=="manual"))await executeStep(admin,step,salt);
 assert.equal(JSON.stringify([admin.tables.customers,admin.tables.orders,admin.tables.whatsapp_messages]),snapshot,"a second run converges to the same state");
 await assert.rejects(executePlan(ctxOf(admin,{actorId:"operador"}),{planId:plan.id}),/APPROVAL_REQUIRED/,"a completed plan is closed");
});
test("T13 anonymization keeps aggregate totals",async()=>{
 const admin=fakeDb(seed()),sum=()=>admin.tables.orders.reduce((n,o)=>n+o.total_cents,0),count=admin.tables.orders.length,before=sum();
 const request=await verifiedRequest(admin,"deletion");await approveAndRun(admin,request);
 assert.equal(sum(),before);assert.equal(admin.tables.orders.length,count);
 const order=admin.tables.orders.find(o=>o.id==="o1");assert.deepEqual(order.delivery_address,{neighborhood:"Centro",city:"São Paulo"});
 assert.deepEqual(reidentificationRisks({customer_name:order.customer_name,customer_phone:order.customer_phone,notes:order.notes},["customer_name"]),[]);
 assert.ok(reidentificationRisks({customer_phone:"11 90000-0001"}).length>0,"a raw phone would be caught");
});
test("T14 a retention dry run changes no data",async()=>{
 const admin=fakeDb({...seed(),retention_policies:[{id:"pol",context_id:"ctx",name:"Inativos",domain:"customers",dataset:"inactive_customers",period_days:30,trigger:"after_last_order",action:"anonymize",requires_approval:true,status:"active"}]});
 admin.tables.customers[0].last_order_at="2025-01-01T00:00:00Z";const before=JSON.stringify(admin.tables.customers);
 const{report}=await runRetention(ctxOf(admin),{policyId:"pol",mode:"dry_run"});
 assert.equal(report.due,1);assert.equal(JSON.stringify(admin.tables.customers),before);
 assert.equal((admin.tables.privacy_deletion_plans||[]).length,0);
});
test("T15 a real retention run needs approval",async()=>{
 assert.deepEqual(retentionRunGate({mode:"execute",executionFlag:false,requiresApproval:true}).issues,["RETENTION_EXECUTION_DISABLED","APPROVAL_REQUIRED"]);
 assert.equal(retentionRunGate({mode:"execute",executionFlag:true,approvalStatus:"approved",requiresApproval:true}).allowed,true);
 const admin=fakeDb({...seed(),retention_policies:[{id:"pol",context_id:"ctx",name:"Inativos",domain:"customers",dataset:"inactive_customers",period_days:30,trigger:"after_last_order",action:"anonymize",requires_approval:true,status:"active"}]});
 await assert.rejects(runRetention(ctxOf(admin),{policyId:"pol",mode:"execute"}),/APPROVAL_REQUIRED/);
 await assert.rejects(runRetention(ctxOf(admin,{flags:{privacy_retention_execution_enabled:false}}),{policyId:"pol",mode:"execute"}),/RETENTION_EXECUTION_DISABLED/);
});
test("T16 the audit records the deletion without the deleted data",async()=>{
 const admin=fakeDb(seed()),request=await verifiedRequest(admin,"deletion");await approveAndRun(admin,request);
 const trail=JSON.stringify([admin.tables.privacy_audit_events,admin.tables.security_audit_logs,admin.tables.privacy_dsr_events,admin.tables.privacy_deletion_steps]);
 assert.ok(admin.tables.privacy_audit_events.some(e=>e.action==="deletion_executed"));
 for(const value of["Maria","90000-0001","maria@teste.dev","Rua Teste","picles","amendoim"])assert.ok(!trail.includes(value),`audit leaked ${value}`);
});
test("T17 DSR deadlines and alerts",async()=>{
 assert.equal(dsrDueAt({type:"access",receivedAt:"2026-11-01T00:00:00Z",deadlineDays:{default:15}}),"2026-11-16T00:00:00.000Z");
 assert.equal(dsrDueAt({type:"access",receivedAt:"2026-11-01T00:00:00Z",deadlineDays:{access:5,default:15}}),"2026-11-06T00:00:00.000Z");
 assert.equal(dsrDueAt({type:"access",receivedAt:"2026-11-01T00:00:00Z",deadlineDays:{}}),null,"no configured deadline, no invented one");
 const now=new Date("2026-11-14T00:00:00Z");
 assert.equal(dsrAlert({dueAt:"2026-11-16T00:00:00Z",status:"in_progress",now,alertDaysBefore:3}),"due_soon");
 assert.equal(dsrAlert({dueAt:"2026-11-10T00:00:00Z",status:"in_progress",now,alertDaysBefore:3}),"overdue");
 assert.equal(dsrAlert({dueAt:"2026-11-10T00:00:00Z",status:"fulfilled",now,alertDaysBefore:3}),"none");
 const sent=[],admin=fakeDb({...seed(),customer_privacy_requests:[{id:"q1",context_id:"ctx",status:"in_progress",due_at:"2026-11-10T00:00:00Z",assignee_id:"gerente",establishment_id:"s1",request_type:"access"}]});
 const r=await scanDeadlines(ctxOf(admin,{notify:async(_a,x)=>sent.push(x)}),now);assert.equal(r.alerted,1);assert.equal(sent[0].eventType,"privacy.dsr_overdue");
 assert.equal((await scanDeadlines(ctxOf(admin,{notify:async(_a,x)=>sent.push(x)}),now)).alerted,0,"one alert per level");
});
test("T18 identity is verified before any data is delivered",async()=>{
 const admin=fakeDb(seed()),ctx=ctxOf(admin),{request}=await createRequest(ctx,{type:"access",channel:"whatsapp",customerId:"c1",storeId:"s1"});
 assert.equal(request.verification_status,"pending");assert.equal(verificationRequirement({type:"access",channel:"whatsapp"}).collectDocument,false);
 await assert.rejects(generateAccessPackage(ctx,{id:request.id}),/VERIFICATION_REQUIRED/);
 let code="";const sendCode=async x=>{code=x.text.match(/\d{6}/)[0];assert.equal(x.to,"11900000001","only the phone on file");return true};
 const started=await startVerification({...ctx,sendCode},{id:request.id});assert.equal(started.status,"code_sent");
 await assert.rejects(confirmVerification(ctx,{id:request.id,code:"000000"===code?"111111":"000000"}),/CODE_INVALID/);
 await confirmVerification(ctx,{id:request.id,code});
 assert.ok((await generateAccessPackage(ctx,{id:request.id})).package.id);
 assert.ok(!JSON.stringify(admin.tables.privacy_dsr_verifications).includes(code),"only the hash is stored");
 const{request:unverified}=await createRequest(ctx,{type:"deletion",channel:"email",customerId:"c1",storeId:"s1"});
 const preview=await previewDeletion(ctx,{requestId:unverified.id});await requestPlanApproval(ctx,{planId:preview.plan.id});await decidePlan(ctxOf(admin,{actorId:"dpo"}),{planId:preview.plan.id,decision:"approved",reason:"Aprovado no teste"});
 await assert.rejects(executePlan(ctx,{planId:preview.plan.id}),/VERIFICATION_REQUIRED/,"nothing is deleted for an unverified requester");
});
test("T19 AI neither executes deletion nor answers without approval",async()=>{
 for(const tool of PRIVACY_COPILOT_TOOLS){const out=privacyCopilot(tool,{cards:{}},{});assert.equal(out.canExecuteDeletion,false);assert.equal(out.canRespondToSubject,false);assert.equal(out.canDefineLegalBasis,false);assert.equal(out.canDecideIncidentNotification,false)}
 assert.equal(privacyCopilot("draftDsrResponse",{},{request:{request_type:"access"}}).requiresApproval,true);
 const admin=fakeDb(seed()),request=await verifiedRequest(admin,"deletion"),preview=await previewDeletion(ctxOf(admin),{requestId:request.id});await requestPlanApproval(ctxOf(admin),{planId:preview.plan.id});
 await assert.rejects(decidePlan(ctxOf(admin,{actorType:"ai",actorId:"bot"}),{planId:preview.plan.id,decision:"approved",reason:"aprovado pela IA"}),/HUMAN_DECISION_REQUIRED/);
 await assert.rejects(executePlan(ctxOf(admin,{actorType:"ai"}),{planId:preview.plan.id}),/HUMAN_DECISION_REQUIRED/);
 await saveResponseDraft(ctxOf(admin),{id:request.id,text:"Rascunho preparado pelo assistente.",byAi:true});
 assert.equal(admin.tables.customer_privacy_requests.find(r=>r.id===request.id).response_sent_at,undefined,"a draft is not sent");
 await assert.rejects(approveResponse(ctxOf(admin,{actorType:"ai"}),{id:request.id}),/HUMAN_DECISION_REQUIRED/);
 await assert.rejects(decideIncidentNotification(ctxOf(admin,{actorType:"ai"}),{id:"x",anpd:"notify",subjects:"notify",reason:"decidido automaticamente pela IA"}),/HUMAN_DECISION_REQUIRED/);
 await assert.rejects(decidePlan(ctxOf(admin),{planId:preview.plan.id,decision:"approved",reason:"eu mesmo"}),/SELF_APPROVAL_BLOCKED/);
});
test("T20 a new personal column without mapping gives a warning",async()=>{
 const detected=detectPersonalColumns("alter table public.customers add column whatsapp text, add column favorite_color text;\ncreate table public.guest_list(id uuid primary key, email text, name text, plan_name text);\ncreate table public.retention_policies(id uuid, name text);");
 assert.deepEqual(detected.map(x=>`${x.table}.${x.column}`).sort(),["customers.whatsapp","guest_list.email","guest_list.name"]);
 assert.deepEqual(unmappedPersonalColumns(detected,[{table_name:"guest_list",column_name:"email"}]).map(x=>x.column).sort(),["name","whatsapp"]);
 const[script,workflow]=await Promise.all([file("../scripts/quality/personal-data-check.mjs"),file("../.github/workflows/quality.yml")]);
 assert.match(script,/::warning::/);assert.doesNotMatch(script,/process\.exit\(1\)/,"warning only");assert.match(workflow,/pnpm qa:personal-data/);
});
test("T21 tenant isolation and RLS on every new table",async()=>{
 const s=await migrations(),created=[...s.matchAll(/create table public\.(\w+)\(/g)].map(m=>m[1]);
 assert.ok(created.length>=25);
 for(const table of created)assert.match(s,new RegExp(`'${table}'`),`${table} sem RLS/revoke`);
 assert.equal((s.match(/enable row level security/g)||[]).length,7);
 assert.match(s,/revoke all on public\.%I from public,anon,authenticated/);
 assert.doesNotMatch(s,/to authenticated/,"no direct client access");
 const admin=fakeDb(seed());assert.equal(await resolveSubject(admin,{contextId:"ctx",organizationId:"o",organizationCustomerId:"oc9"}),null);
});
test("T22 RBAC is governed by Identity Governance (Phase 93)",async()=>{
 const catalog=new AccessCatalogService().compose({modulePermissions:{soc:[],vendor:[],idgov:[],privacy:PRIVACY_PERMISSIONS},apiScopes:[]});
 const del=catalog.find(x=>x.key==="perm:privacy:execute_deletion"),dpo=catalog.find(x=>x.key==="perm:privacy:dpo");
 assert.equal(del.criticality,"critical");assert.equal(del.privileged,true);assert.equal(dpo.criticality,"critical");
 assert.equal(PRIVACY_PERMISSIONS.length,15);
 const manager=new PrivacyAccessService().resolve({storeRole:"manager"});
 assert.ok(manager.includes("privacy:handle_dsr")&&!manager.includes("privacy:execute_deletion")&&!manager.includes("privacy:dpo"));
 assert.ok(!new PrivacyAccessService().resolve({orgRole:"admin"}).includes("privacy:dpo"));
 const[s,server]=await Promise.all([migrations(),file("../lib/identity-governance/server.ts")]);
 assert.match(s,/elsif requested_module='privacy' and requested_permission_key like 'privacy:%'/);assert.match(server,/privacy:PRIVACY_PERMISSIONS/);
});
test("T23 a module failure does not block orders",async()=>{
 const admin=fakeDb(seed(),{missing:["store_feature_flags"]});
 const gate=await marketingConsentGate(admin,{storeId:"s1",customerId:"c1",purposeKey:"marketing_whatsapp",channel:"whatsapp"});
 assert.equal(gate.mode,"legacy","without the migration the old rules run alone");
 assert.equal(isNotInstalled({code:"42703",message:"column store_feature_flags.privacy_operations_enabled does not exist"}),true);
 const route=await file("../app/api/privacy/route.ts");assert.match(route,/PRIVACY_NOT_INSTALLED"},503\)/);
 const checkout=await Promise.all(["../app/api/public-orders/route.ts","../app/api/stripe/checkout/route.ts","../app/api/security/login/route.ts"].map(p=>file(p).catch(()=>"")));
 for(const source of checkout)assert.doesNotMatch(source,/privacy-operations/,"order, payment and login paths do not depend on the module");
 const flags=(await migrations()).match(/add column if not exists privacy_\w+ boolean not null default false/g)||[];assert.equal(flags.length,10,"5 flags in plans and in stores, all off");
});
test("T24 domain adapters cover the brief and pending ones are explicit",()=>{
 for(const d of["customers","orders","delivery","whatsapp","voice","reservations","journeys","customer_experience"])assert.ok(IMPLEMENTED_DOMAINS.includes(d));
 assert.ok(ADAPTER_SPECS.every(s=>s.anonymizeOnly||s.deleteRow||s.legalRetention||s.storage),"each table says how it is handled");
 assert.throws(()=>anonymizeValue("tokenize","x",{salt:"x".repeat(32)}),/TOKENIZATION_REQUIRES_GOVERNED_VAULT/);
 assert.notEqual(anonymizeValue("hash","11900000001",{salt:"a".repeat(32)}),anonymizeValue("hash","11900000001",{salt:"b".repeat(32)}),"salt per tenant");
});
test("T25 a deletion request is fulfilled only by a completed plan, never by a click",async()=>{
 const admin=fakeDb(seed()),ctx=ctxOf(admin),request=await verifiedRequest(admin,"deletion");
 await transitionRequest(ctx,{id:request.id,to:"in_progress"});
 await assert.rejects(transitionRequest(ctx,{id:request.id,to:"fulfilled"}),/DELETION_PLAN_NOT_COMPLETED/);
 assert.equal(admin.tables.customers.find(c=>c.id==="c1").name,"Maria Teste","nothing was deleted, so it cannot be marked done");
 const access=await verifiedRequest(admin,"access");await transitionRequest(ctx,{id:access.id,to:"in_progress"});
 assert.equal((await transitionRequest(ctx,{id:access.id,to:"fulfilled"})).status,"fulfilled","other types keep the manual close");
 // A marketplace partner without an erasure API is a manual step, so the request stays partial until someone confirms.
 const admin2=fakeDb({...seed(),marketplace_order_links:[{id:"ml1",internal_order_id:"o1",snapshot_id:"snap1",connection_id:"conn1"}],marketplace_order_snapshots:[{id:"snap1",normalized_snapshot:{customer_name:"Maria Teste",items:[1]}}]}),req2=await verifiedRequest(admin2,"deletion");const{result}=await approveAndRun(admin2,req2,{});
 assert.equal(result.status,"partially_completed","pending domains keep it partial");
 assert.equal(admin2.tables.customer_privacy_requests.find(r=>r.id===req2.id).status,"partially_fulfilled");
});
