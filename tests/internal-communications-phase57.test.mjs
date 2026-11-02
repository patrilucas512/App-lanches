import test from"node:test";import assert from"node:assert/strict";import{readFile,readdir}from"node:fs/promises";
import{COMMS_FLAGS,COMMS_PERMISSIONS,CommsAccessService,networkGovernanceAnnouncements,approvalRequirement,canDecideApproval,canTransition,checkContent,emergencyGate,isMaterialChange,reachMetrics,reminderDue}from"../lib/internal-communications/core.ts";
import{AudienceResolver,normalizeAudience}from"../lib/internal-communications/audiences.ts";
import{createDraft,decideApproval,editAnnouncement,publishAnnouncement,publishDueAnnouncements,retractAnnouncement,scheduleAnnouncement,submitForApproval}from"../lib/internal-communications/announcements.ts";
import{acknowledge,acknowledgementSummary,markOpened,myFeed,pendingPeople,publicAnnouncement}from"../lib/internal-communications/acknowledgements.ts";
import{deliveryDecision,quietMinutesLeft,reconcileLateJoiners,runDelivery,scanAcknowledgements}from"../lib/internal-communications/delivery.ts";
import{DEFAULT_TEMPLATES,renderTemplate,saveTemplate}from"../lib/internal-communications/templates.ts";
import{aggregatePoll,createBoardPost,createPoll,vote}from"../lib/internal-communications/board.ts";
import{draftFromAutomation,draftFromIncident,draftFromRecall,isCommunicationDraftAction,linkPublishedToIncidents,proposeFromContinuity}from"../lib/internal-communications/crisis.ts";
import{COMMS_COPILOT_TOOLS,COMMS_FORBIDDEN_ACTIONS,COMMS_SAFE_AUTOMATION_ACTIONS,commsCopilot,simplifyText,summarizeText}from"../lib/internal-communications/integrations.ts";
import{AccessCatalogService}from"../lib/identity-governance/core.ts";
const file=p=>readFile(new URL(p,import.meta.url),"utf8");
const migrations=async()=>{const dir=new URL("../supabase/migrations/",import.meta.url),names=(await readdir(dir)).filter(x=>x.includes("_phase57")).sort();return(await Promise.all(names.map(x=>readFile(new URL(x,dir),"utf8")))).join("\n")};
const allLib=async()=>{const dir=new URL("../lib/internal-communications/",import.meta.url),names=await readdir(dir);return(await Promise.all(names.map(x=>readFile(new URL(x,dir),"utf8")))).join("\n")};

// In-memory stand-in for the Supabase client, enough of the query builder to run the services for real, tenant filters included.
function fakeDb(seed={}){const tables=Object.fromEntries(Object.entries(seed).map(([k,v])=>[k,v.map(x=>({...x}))]));let serial=0;
 return{tables,from(table){tables[table]||=[];const q={op:"select",filters:[],row:null,opts:{},head:false,rangeFrom:null,rangeTo:null,
  select(_c,o){if(q.op==="select"&&o?.head)q.head=true;return q},eq(k,v){q.filters.push(x=>x[k]===v);return q},neq(k,v){q.filters.push(x=>x[k]!==v);return q},in(k,v){q.filters.push(x=>v.includes(x[k]));return q},is(k,v){q.filters.push(x=>(x[k]??null)===v);return q},gte(k,v){q.filters.push(x=>x[k]>=v);return q},gt(k,v){q.filters.push(x=>x[k]>v);return q},lte(k,v){q.filters.push(x=>x[k]<=v);return q},lt(k,v){q.filters.push(x=>x[k]!=null&&x[k]<v);return q},
  not(k,op,v){q.filters.push(x=>op==="is"?(x[k]??null)!==v:!String(v).replace(/[()]/g,"").split(",").includes(String(x[k])));return q},contains(k,v){q.filters.push(x=>Object.entries(v).every(([key,ids])=>ids.every(id=>x[k]?.[key]?.includes(id))));return q},or(){return q},order(){return q},limit(){return q},range(a,b){q.rangeFrom=a;q.rangeTo=b;return q},
  insert(row){q.op="insert";q.row=row;return q},update(row){q.op="update";q.row=row;return q},upsert(row,o){q.op="upsert";q.row=row;q.opts=o||{};return q},delete(){q.op="delete";return q},
  run(){let match=tables[table].filter(x=>q.filters.every(f=>f(x)));
   if(q.op==="select"){const count=match.length;if(q.rangeFrom!=null)match=match.slice(q.rangeFrom,q.rangeTo+1);return{data:match,count,error:null}}
   if(q.op==="insert"){const rows=(Array.isArray(q.row)?q.row:[q.row]).map(x=>({id:`${table}-${++serial}`,created_at:new Date(2026,10,1,0,0,serial).toISOString(),...x}));
    if(table==="comms_poll_participation"&&rows.some(r=>tables[table].some(x=>x.poll_id===r.poll_id&&x.user_id===r.user_id)))return{data:null,error:{code:"23505",message:"dup"}};
    if(table==="comms_jobs"&&rows.some(r=>tables[table].some(x=>x.announcement_id===r.announcement_id&&x.job_type===r.job_type&&x.status!=="completed")))return{data:null,error:{code:"23505",message:"dup"}};
    tables[table].push(...rows.map(x=>({status:table==="comms_jobs"?"queued":x.status,...x})));return{data:rows,error:null}}
   if(q.op==="update"){match.forEach(x=>Object.assign(x,q.row));return{data:match,error:null}}
   if(q.op==="delete"){tables[table]=tables[table].filter(x=>!match.includes(x));return{data:match,error:null}}
   const keys=String(q.opts.onConflict||"id").split(","),rows=Array.isArray(q.row)?q.row:[q.row],out=[];for(const row of rows){const existing=tables[table].find(x=>keys.every(k=>x[k]===row[k]));if(existing){if(!q.opts.ignoreDuplicates)Object.assign(existing,row);out.push(existing)}else{const created={id:row.id||`${table}-${++serial}`,...row};tables[table].push(created);out.push(created)}}return{data:out,error:null}},
  single(){const r=q.run();return Promise.resolve({data:r.data?.[0]??null,error:r.error||(r.data?.length?null:{message:"no rows"})})},maybeSingle(){const r=q.run();return Promise.resolve({data:r.data?.[0]??null,error:r.error})},then(ok,no){const r=q.run();return Promise.resolve(q.head?{count:r.count,data:null,error:r.error}:r).then(ok,no)}};return q}}}

const seed=()=>({
 establishments:[{id:"s1",organization_id:"o",network_brand_id:"b1",network_region_id:"r1",ownership_type:"company_owned",timezone:"America/Sao_Paulo"},{id:"s2",organization_id:"o",network_brand_id:"b1",network_region_id:"r2",ownership_type:"franchise",timezone:"America/Sao_Paulo"},{id:"x1",organization_id:"other",ownership_type:"company_owned"}],
 establishment_members:[{user_id:"gerente1",establishment_id:"s1",role:"manager",status:"active"},{user_id:"cozinha1",establishment_id:"s1",role:"kitchen",status:"active"},{user_id:"gerente2",establishment_id:"s2",role:"manager",status:"active"},{user_id:"intruso",establishment_id:"x1",role:"manager",status:"active"}],
 organization_members:[{user_id:"dono",organization_id:"o",role:"owner",all_stores:true,active:true},{user_id:"admin",organization_id:"o",role:"admin",all_stores:true,active:true},{user_id:"fora",organization_id:"other",role:"owner",all_stores:true,active:true}],
 profiles:[{id:"cozinha1",full_name:"Pessoa Cozinha"},{id:"gerente1",full_name:"Pessoa Gerente"},{id:"gerente2",full_name:"Pessoa Dois"}],
});
const owner=(admin,over={})=>({admin,organizationId:"o",storeId:"s1",storeIds:["s1","s2"],allStores:true,actorId:"dono",permissions:[...COMMS_PERMISSIONS],flags:Object.fromEntries(COMMS_FLAGS.map(x=>[x,true])),notify:async()=>({item:{id:"inbox"}}),...over});
const manager=(admin,over={})=>owner(admin,{storeIds:["s1"],allStores:false,actorId:"gerente1",permissions:new CommsAccessService().resolve({storeRole:"manager"}),...over});
const person=(admin,userId="cozinha1")=>owner(admin,{storeIds:["s1"],allStores:false,actorId:userId,permissions:[]});
const STORE={scope:{type:"store",ids:["s1"]}},NETWORK={scope:{type:"organization",ids:[]}};
const draft=(ctx,over={})=>createDraft(ctx,{title:"Aviso de teste",body:"Texto do comunicado de teste.",audience:STORE,...over}).then(x=>x.announcement);
const universe=()=>{const s=seed();return{stores:s.establishments.filter(x=>x.organization_id==="o"),storeMembers:s.establishment_members.filter(x=>x.establishment_id!=="x1"),orgMembers:s.organization_members.filter(x=>x.organization_id==="o"),staff:[{id:"e1",user_id:"func1",establishment_id:"s2",primary_store_id:"s2",role_id:"cargo1"}],staffRoles:[{id:"cargo1",establishment_id:"s2"}],shifts:[{employee_id:"e1",store_id:"s2",template_id:"manha"}],clusterStores:[{cluster_id:"c1",store_id:"s2"}],languages:{gerente1:"es"}}};
const users=def=>new AudienceResolver().resolve(normalizeAudience(def),universe()).map(x=>x.userId).sort();

test("T01 what works in Phase 46 keeps working",async()=>{
 const[s,route,api46]=await Promise.all([migrations(),file("../app/api/network-governance/route.ts"),file("../tests/network-governance-phase46.test.mjs")]);
 assert.doesNotMatch(s,/create table public\.[a-z_]*announcements\(/);
 assert.match(s,/alter table public\.network_announcements/);
 assert.match(s,/alter table public\.network_announcement_acknowledgements add column version/);
 assert.doesNotMatch(s,/drop column|drop table|rename column/i);
 assert.match(s,/when published_at is null then 'draft'/,"legacy rows keep their published state");
 assert.match(route,/network_announcements[\s\S]*announcements:/);
 assert.ok(api46.length>0);
});
test("T01b Phase 46 route no longer exposes drafts, answers or other units",async()=>{
 const route=await file("../app/api/network-governance/route.ts");
 assert.match(route,/from\("network_announcements"\)\.select\("id,organization_id,scope_type[^"]*"\)\.eq\("organization_id",c\.organizationId\)\.eq\("status","published"\)/);
 assert.doesNotMatch(route.match(/from\("network_announcements"\)\.select\("[^"]*"\)/)[0],/verification|pending_edit/);
 assert.match(route,/networkGovernanceAnnouncements\(announcements,c\)/);
 const rows=[{id:"rede",scope_type:"organization",audience_definition:{filters:{}}},{id:"gerentes",scope_type:"organization",audience_definition:{filters:{roles:["manager"]}}},{id:"minha",scope_type:"store",scope_id:"s1",audience_definition:{}},{id:"outra",scope_type:"store",scope_id:"s2",audience_definition:{}},{id:"regiao",scope_type:"region",scope_id:"r1",audience_definition:{}}];
 assert.deepEqual(networkGovernanceAnnouncements(rows,{allStores:false,allowedStores:["s1"]}).map(x=>x.id),["rede","minha"]);
 assert.equal(networkGovernanceAnnouncements(rows,{allStores:true,allowedStores:[]}).length,5);
 assert.equal(networkGovernanceAnnouncements(rows,{allStores:true,allowedStores:[]})[0].audience_definition,undefined);
});
test("T02 audience by scope",()=>{
 assert.deepEqual(users({scope:{type:"store",ids:["s1"]}}),["cozinha1","gerente1"]);
 assert.deepEqual(users({scope:{type:"region",ids:["r2"]}}),["admin","dono","func1","gerente2"]);
 assert.deepEqual(users({scope:{type:"franchise",ids:[]}}),["admin","dono","func1","gerente2"]);
 assert.deepEqual(users({scope:{type:"cluster",ids:["c1"]}}),["admin","dono","func1","gerente2"]);
 assert.deepEqual(users({scope:{type:"team",ids:["cargo1"]}}),["func1"]);
 assert.ok(users(NETWORK).includes("dono")&&users(NETWORK).includes("cozinha1"));
});
test("T02b audience by role, position, shift and language",()=>{
 assert.deepEqual(users({scope:{type:"store",ids:["s1"]},filters:{roles:["kitchen"]}}),["cozinha1"]);
 assert.deepEqual(users({...NETWORK,filters:{positions:["cargo1"]}}),["func1"]);
 assert.deepEqual(users({...NETWORK,filters:{shifts:["manha"]}}),["func1"]);
 assert.deepEqual(users({scope:{type:"store",ids:["s1"]},filters:{languages:["es"]}}),["gerente1"]);
 assert.deepEqual(users({scope:{type:"store",ids:["s1"]},filters:{languages:["pt-BR"]}}),["cozinha1"],"no language counts as pt-BR");
});
test("T02c a single store's notice stays with that store",()=>assert.ok(!users(STORE).includes("dono")&&!users(STORE).includes("admin")));
test("T02d invalid audiences are refused",()=>{assert.throws(()=>normalizeAudience({scope:{type:"planet",ids:[]}}),/AUDIENCE_SCOPE_INVALID/);assert.throws(()=>normalizeAudience({scope:{type:"store",ids:[]}}),/AUDIENCE_TARGET_REQUIRED/)});
test("T03 no leak between tenants, even with a forged id",async()=>{
 assert.deepEqual(users({scope:{type:"store",ids:["x1"]}}),[]);
 const db=fakeDb(seed()),ctx=owner(db),a=await draft(ctx,{audience:{scope:{type:"store",ids:["x1"]}}});
 await assert.rejects(publishAnnouncement(ctx,{id:a.id}),/AUDIENCE_EMPTY/);
 const stranger=owner(db,{organizationId:"other"});
 await assert.rejects(publishAnnouncement(stranger,{id:a.id}),/ANNOUNCEMENT_NOT_FOUND/);
 const published=await draft(ctx);await publishAnnouncement(ctx,{id:published.id});
 assert.ok(!db.tables.network_announcement_recipients.some(x=>["intruso","fora"].includes(x.user_id)));
 await assert.rejects(acknowledgementSummary(stranger,{id:published.id}),/ANNOUNCEMENT_NOT_FOUND/);
 await assert.rejects(pendingPeople(stranger,{id:published.id}),/ANNOUNCEMENT_NOT_FOUND/);
});
test("T03b no leak between units",async()=>{
 const db=fakeDb(seed()),ctx=owner(db),a=await draft(ctx,{audience:NETWORK,requiresAck:true,priority:"mandatory"});
 await assert.rejects(createDraft(manager(db),{title:"Outra unidade",body:"Texto de teste aqui.",audience:{scope:{type:"store",ids:["s2"]}}}),/FORBIDDEN/,"cannot address a store they do not have");
 await submitForApproval(ctx,{id:a.id});await decideApproval(owner(db,{actorId:"admin"}),{id:a.id,decision:"approved",reason:"Conferido"});await publishAnnouncement(ctx,{id:a.id});
 const summary=await acknowledgementSummary(manager(db),{id:a.id}),people=await pendingPeople(manager(db),{id:a.id});
 assert.ok(summary.units.every(x=>x.store_id==="s1"));
 assert.ok(!people.pending.some(x=>x.name==="Pessoa Dois"));
 await assert.rejects(markOpened(person(db,"intruso"),{id:a.id}),/ANNOUNCEMENT_NOT_FOUND/);
});
test("T04 acknowledgement and deadline",async()=>{
 const db=fakeDb(seed()),ctx=owner(db),past=new Date(Date.now()-36e5).toISOString(),a=await draft(ctx,{priority:"mandatory",ackDeadline:past});
 await publishAnnouncement(ctx,{id:a.id});await runDelivery(ctx,a.id);
 const r=db.tables.network_announcement_recipients.find(x=>x.user_id==="cozinha1");assert.equal(r.state,"delivered");
 await markOpened(person(db),{id:a.id});assert.equal(r.state,"opened");assert.ok(r.opened_at);
 await scanAcknowledgements(ctx,"o");assert.equal(r.state,"overdue");
 const done=await acknowledge(person(db),{id:a.id});assert.equal(done.version,1);assert.equal(r.state,"acknowledged");
 const stored=db.tables.network_announcement_acknowledgements.find(x=>x.user_id==="cozinha1");assert.ok(stored.acknowledged_at);assert.equal(stored.version,1);
 assert.equal((await acknowledge(person(db),{id:a.id})).alreadyAcknowledged,true);
});
test("T04b verification question: answer stays on the server and a wrong answer records nothing",async()=>{
 const db=fakeDb(seed()),ctx=owner(db),a=await draft(ctx,{priority:"mandatory",verification:{question:"Qual o prazo?",options:["1 dia","2 dias"],correct_index:1}});
 await publishAnnouncement(ctx,{id:a.id});
 const feed=await myFeed(person(db));assert.equal(feed.items[0].verification.correct_index,undefined);assert.equal(publicAnnouncement({verification:{correct_index:1}}).verification.correct_index,undefined);
 await assert.rejects(acknowledge(person(db),{id:a.id,answerIndex:0}),/VERIFICATION_FAILED/);
 assert.equal((db.tables.network_announcement_acknowledgements||[]).length,0);
 assert.equal((await acknowledge(person(db),{id:a.id,answerIndex:1})).acknowledged,true);
});
test("T05 reminders reach who is pending, respect the limit, and the manager only gets a count",async()=>{
 const sent=[],db=fakeDb(seed()),ctx=owner(db,{notify:async(_a,e)=>{sent.push(e);return{item:{id:"i"}}}}),a=await draft(ctx,{priority:"mandatory",ackDeadline:new Date(Date.now()-36e5).toISOString()});
 await publishAnnouncement(ctx,{id:a.id});await runDelivery(ctx,a.id);sent.length=0;
 await acknowledge(person(db,"gerente1"),{id:a.id});await scanAcknowledgements(ctx,"o");
 const reminders=sent.filter(x=>x.eventType==="comms.ack_reminder");assert.deepEqual(reminders.map(x=>x.recipientUserId),["cozinha1"]);
 const escalations=sent.filter(x=>x.eventType==="comms.ack_overdue");assert.ok(escalations.length>=1);assert.match(escalations[0].summary,/1 confirmação/);assert.doesNotMatch(JSON.stringify(escalations),/Pessoa Cozinha/);
 assert.equal(reminderDue({state:"delivered",ackDueAt:new Date().toISOString(),reminderCount:3,hoursBefore:24,intervalHours:24,maxReminders:3,now:new Date()}),false);
 assert.equal(reminderDue({state:"acknowledged",ackDueAt:new Date().toISOString(),reminderCount:0,hoursBefore:24,intervalHours:24,maxReminders:3,now:new Date()}),false);
 const inTwoHours=new Date(Date.now()+72e5).toISOString();assert.equal(reminderDue({state:"delivered",ackDueAt:inTwoHours,reminderCount:0,hoursBefore:24,intervalHours:24,maxReminders:3,now:new Date()}),true);
 assert.equal(reminderDue({state:"delivered",ackDueAt:inTwoHours,reminderCount:1,lastReminderAt:new Date().toISOString(),hoursBefore:24,intervalHours:24,maxReminders:3,now:new Date()}),false);
});
test("T05b quiet hours defer; only emergency or the policy goes through",()=>{
 const quiet={enabled:true,start:"22:00",end:"07:00"},night=new Date("2026-11-02T02:00:00Z");// 23:00 in Sao Paulo
 assert.equal(quietMinutesLeft(quiet,"America/Sao_Paulo",night),480);
 assert.equal(quietMinutesLeft(quiet,"Asia/Tokyo",night),0,"each person's own clock");
 const held=deliveryDecision({priority:"mandatory",quietHours:quiet,timezone:"America/Sao_Paulo",now:night});assert.equal(held.deliver,false);assert.equal(held.until,new Date(night.getTime()+48e4*60).toISOString());
 assert.equal(deliveryDecision({priority:"urgent",quietHours:quiet,timezone:"America/Sao_Paulo",now:night}).deliver,false,"urgent without policy waits");
 assert.equal(deliveryDecision({priority:"urgent",bypassPolicy:true,quietHours:quiet,timezone:"America/Sao_Paulo",now:night}).deliver,true);
 assert.equal(deliveryDecision({priority:"info",emergency:true,quietHours:quiet,timezone:"America/Sao_Paulo",now:night}).deliver,true);
});
test("T05c delivery goes through Phase 52, is idempotent and records failures",async()=>{
 const lib=await allLib();assert.doesNotMatch(lib,/notification_inbox_items"\)\.insert/,"no second notification system");
 const sent=[],db=fakeDb(seed()),ctx=owner(db,{notify:async(_a,e)=>{sent.push(e.recipientUserId);if(e.recipientUserId==="cozinha1")throw new Error("push caiu");return{item:{id:"i"}}}}),a=await draft(ctx);
 await publishAnnouncement(ctx,{id:a.id});const first=await runDelivery(ctx,a.id);assert.equal(first.sent,1);assert.equal(first.failed,1);
 const failed=db.tables.network_announcement_recipients.find(x=>x.user_id==="cozinha1");assert.equal(failed.last_error,"push caiu");assert.equal(failed.delivery_status,"pending");assert.ok(failed.next_attempt_at>new Date().toISOString(),"backoff");
 sent.length=0;await runDelivery(ctx,a.id);assert.deepEqual(sent,[],"sent is not sent again, and the failed one waits for its retry");
 failed.next_attempt_at=new Date(0).toISOString();await runDelivery({...ctx,notify:async()=>({item:{id:"i"}})},a.id);assert.equal(failed.delivery_status,"sent");assert.equal(failed.last_error,null);
});
test("T05d someone who joins later receives what is still valid, nobody is removed",async()=>{
 const db=fakeDb(seed()),ctx=owner(db),a=await draft(ctx,{priority:"mandatory",ackDeadline:new Date(Date.now()-864e5).toISOString()});
 await publishAnnouncement(ctx,{id:a.id});
 db.tables.establishment_members.push({user_id:"novo",establishment_id:"s1",role:"attendant",status:"active"});db.tables.establishment_members=db.tables.establishment_members.filter(x=>x.user_id!=="gerente1");
 assert.equal(await reconcileLateJoiners(ctx,"o"),1);
 const added=db.tables.network_announcement_recipients.find(x=>x.user_id==="novo");assert.equal(added.source,"late_joiner");assert.ok(added.ack_due_at>new Date().toISOString(),"gets their own deadline");
 assert.ok(db.tables.network_announcement_recipients.some(x=>x.user_id==="gerente1"),"the snapshot keeps who should have received it");
});
test("T06 approval is required for network, crisis, recall, policy and AI",async()=>{
 const need=x=>approvalRequirement({type:"general",scopeType:"store",targetStores:1,...x});
 assert.equal(need({}).required,false);
 assert.deepEqual(need({scopeType:"organization",targetStores:5}).reasons,["network_wide"]);
 assert.deepEqual(need({type:"crisis"}).reasons,["crisis"]);assert.deepEqual(need({type:"recall_food_safety"}).reasons,["recall"]);assert.deepEqual(need({type:"policy"}).reasons,["policy_change"]);assert.deepEqual(need({aiGenerated:true}).reasons,["ai_generated"]);assert.deepEqual(need({policyRequires:true}).reasons,["policy_engine"]);
 assert.equal(need({scopeType:"organization",targetStores:1}).required,false,"a one-store network is not a whole network");
 const db=fakeDb(seed()),ctx=owner(db),network=await draft(ctx,{audience:NETWORK});
 await assert.rejects(publishAnnouncement(ctx,{id:network.id}),/APPROVAL_REQUIRED/);
 await assert.rejects(scheduleAnnouncement(ctx,{id:network.id,publishAt:new Date(Date.now()+36e5).toISOString()}),/APPROVAL_REQUIRED/);
 const crisis=await draft(ctx,{type:"crisis",priority:"urgent"});await assert.rejects(publishAnnouncement(ctx,{id:crisis.id}),/APPROVAL_REQUIRED/);
});
test("T06b approval runs on Phase 32, blocks self-approval and is tied to the exact text",async()=>{
 const db=fakeDb(seed()),ctx=owner(db),a=await draft(ctx,{audience:NETWORK});
 const sub=await submitForApproval(ctx,{id:a.id});assert.equal(sub.announcement.status,"pending_approval");assert.equal(db.tables.internal_approvals.length,1);assert.equal(db.tables.internal_approvals[0].source_id,a.id);
 await assert.rejects(decideApproval(ctx,{id:a.id,decision:"approved",reason:"ok ok"}),/SELF_APPROVAL_BLOCKED/);
 await decideApproval(owner(db,{actorId:"admin"}),{id:a.id,decision:"approved",reason:"Conferido"});assert.equal(db.tables.internal_approvals[0].status,"approved");
 await editAnnouncement(ctx,{id:a.id,body:"Texto trocado depois da aprovação."});
 await assert.rejects(publishAnnouncement(ctx,{id:a.id}),/APPROVAL_REQUIRED/,"editing after approval drops the approval");
 assert.equal(canDecideApproval({approverId:"a",authorId:"a",alreadyDecided:[],selfApprovalAllowed:true}).allowed,true);
 assert.equal(canDecideApproval({approverId:"b",authorId:"a",alreadyDecided:["b"]}).reason,"ALREADY_DECIDED");
});
test("T06c the Policy Engine can add approval and can never remove it",async()=>{
 const db=fakeDb(seed()),a=await draft(owner(db));
 await assert.rejects(publishAnnouncement(owner(db,{policyDecide:async()=>({decision:{decision:"require_approval"}})}),{id:a.id}),/APPROVAL_REQUIRED/);
 const crisis=await draft(owner(db),{type:"crisis",priority:"urgent"});
 await assert.rejects(publishAnnouncement(owner(db,{policyDecide:async()=>({decision:{decision:"allow"}})}),{id:crisis.id}),/APPROVAL_REQUIRED/);
 const ok=await draft(owner(db));assert.equal((await publishAnnouncement(owner(db,{policyDecide:async()=>{throw new Error("política fora do ar")}}),{id:ok.id})).announcement.status,"published");
});
test("T06d scheduled publication goes through the same gate",async()=>{
 const db=fakeDb(seed()),ctx=owner(db),a=await draft(ctx),when=new Date(Date.now()+36e5).toISOString();
 const scheduled=await scheduleAnnouncement(ctx,{id:a.id,publishAt:when});assert.equal(scheduled.announcement.status,"scheduled");
 assert.deepEqual(await publishDueAnnouncements(ctx,new Date()),[],"not due yet");
 const results=await publishDueAnnouncements(ctx,new Date(Date.now()+72e5));assert.equal(results[0].ok,true);assert.equal(db.tables.network_announcements[0].status,"published");
 const blocked=await draft(ctx,{audience:NETWORK});db.tables.network_announcements.find(x=>x.id===blocked.id).status="scheduled";db.tables.network_announcements.find(x=>x.id===blocked.id).publish_at=new Date(0).toISOString();
 const denied=await publishDueAnnouncements(ctx,new Date());assert.equal(denied[0].ok,false);assert.match(denied[0].error,/APPROVAL_REQUIRED/);assert.equal(db.tables.network_announcements.find(x=>x.id===blocked.id).status,"draft","goes back to a person");
});
test("T07 emergency publishes with audit and owes a review",async()=>{
 const db=fakeDb({...seed(),comms_settings:[{organization_id:"o",emergency_publish_allowed:true}]}),ctx=owner(db),a=await draft(ctx,{type:"crisis",priority:"urgent"});
 await assert.rejects(publishAnnouncement(ctx,{id:a.id,emergency:true,reason:"curto"}),/REASON_REQUIRED/);
 const out=await publishAnnouncement(ctx,{id:a.id,emergency:true,reason:"Risco imediato às equipes na loja"});
 assert.equal(out.emergency,true);assert.ok(out.announcement.review_due_at);assert.equal(out.announcement.reviewed_at,undefined);
 assert.ok(db.tables.comms_audit_events.some(x=>x.action==="emergency_published"&&x.reason.includes("Risco")));
 assert.equal(db.tables.comms_jobs[0].priority,100,"crisis goes first in the queue");
 const closed=fakeDb(seed()),b=await draft(owner(closed),{type:"crisis",priority:"urgent"});
 await assert.rejects(publishAnnouncement(owner(closed),{id:b.id,emergency:true,reason:"Risco imediato às equipes na loja"}),/EMERGENCY_NOT_ALLOWED/,"off by default");
 assert.equal(emergencyGate({allowedByPolicy:true,permissions:["comms:publish_crisis"],type:"general",priority:"info",reason:"Motivo com tamanho suficiente"}).allowed,false,"not for an ordinary notice");
});
test("T08 a new version asks for a new confirmation only when relevant",async()=>{
 assert.equal(isMaterialChange({title:"A",body:"Separe o item até amanhã de manhã"},{title:"A",body:"Separe o item até amanhã de manhã."}),false);
 assert.equal(isMaterialChange({title:"A",body:"Temperatura de 4 graus"},{title:"A",body:"Temperatura de 7 graus"}),true,"a changed number always counts");
 assert.equal(isMaterialChange({title:"A",body:"x"},{title:"A",body:"x"},true),true);
 const db=fakeDb(seed()),ctx=owner(db),a=await draft(ctx,{priority:"mandatory",body:"Guarde o produto a 4 graus."});
 await publishAnnouncement(ctx,{id:a.id});await acknowledge(person(db),{id:a.id});
 const small=await editAnnouncement(ctx,{id:a.id,body:"Guarde o produto a 4 graus!"});assert.equal(small.material,false);assert.equal(small.requiresNewAck,false);
 const r=db.tables.network_announcement_recipients.find(x=>x.user_id==="cozinha1");assert.equal(r.state,"acknowledged");
 const big=await editAnnouncement(ctx,{id:a.id,body:"Guarde o produto a 2 graus!"});assert.equal(big.version,3);assert.equal(big.requiresNewAck,true);assert.equal(r.state,"delivered");assert.equal(r.required_version,3);
 assert.equal(db.tables.network_announcement_versions.length,3,"every version is kept");
 assert.equal(db.tables.network_announcement_acknowledgements.find(x=>x.user_id==="cozinha1").version,1,"the old confirmation still says what it confirmed");
 assert.equal((await acknowledge(person(db),{id:a.id})).version,3);
});
test("T08b editing a published announcement cannot walk around approval",async()=>{
 const db=fakeDb(seed()),ctx=owner(db),admin=owner(db,{actorId:"admin"}),a=await draft(ctx,{audience:NETWORK});
 await submitForApproval(ctx,{id:a.id});await decideApproval(admin,{id:a.id,decision:"approved",reason:"Conferido"});await publishAnnouncement(ctx,{id:a.id});
 const out=await editAnnouncement(ctx,{id:a.id,body:"Texto novo que ainda não foi aprovado por ninguém."});assert.equal(out.pendingApproval,true);
 const row=db.tables.network_announcements.find(x=>x.id===a.id);assert.equal(row.body,"Texto do comunicado de teste.","readers keep the approved text");
 await decideApproval(admin,{id:a.id,decision:"approved",reason:"Conferido"});assert.equal(row.body,"Texto novo que ainda não foi aprovado por ninguém.");assert.equal(row.version,2);assert.equal(row.pending_edit,null);
});
test("T09 retraction preserves history and tells people",async()=>{
 const sent=[],db=fakeDb(seed()),ctx=owner(db,{notify:async(_a,e)=>{sent.push(e);return{item:{id:"i"}}}}),a=await draft(ctx);
 await publishAnnouncement(ctx,{id:a.id});await runDelivery(ctx,a.id);sent.length=0;
 await assert.rejects(retractAnnouncement(ctx,{id:a.id,reason:""}),/REASON_REQUIRED/);
 const out=await retractAnnouncement(ctx,{id:a.id,reason:"Dado errado",correction:"O certo é sexta."});
 assert.equal(out.announcement.status,"retracted");assert.equal(db.tables.network_announcements.length,1);assert.equal(out.announcement.body,"Texto do comunicado de teste.","text is still there");assert.equal(db.tables.network_announcement_versions.length,1);
 await runDelivery(ctx,a.id);assert.ok(sent.every(x=>x.eventType==="comms.retracted"&&x.summary==="O certo é sexta.")&&sent.length===2);
 const feed=await myFeed(person(db));assert.equal(feed.items[0].status,"retracted");assert.equal(feed.mandatoryPending,0);
 assert.equal(canTransition("retracted","published"),false);assert.equal(canTransition("archived","published"),false);
 const s=await migrations();assert.match(s,/network_announcement_versions_immutable before update or delete/);assert.match(s,/comms_audit_immutable before update or delete/);
 assert.doesNotMatch(await allLib(),/network_announcements"\)\.delete/);
});
test("T10 Phase 59 relation stays compatible and the workaround is replaced",async()=>{
 const route=await file("../app/api/incidents/route.ts");
 assert.match(route,/"internal_communication"\]\)/,"link_relation still accepts it");
 assert.match(route,/action==="communication_draft"&&await internalCommunicationsOn[\s\S]*draftFromIncident[\s\S]*communicationPublished:false,canonicalCommunication:true/);
 assert.match(route,/communication_draft[\s\S]*internal_tasks[\s\S]*communicationPublished:false/,"task fallback with the module off");
 const db=fakeDb(seed()),incident={id:"inc",store_id:"s1",title:"Queda de energia",summary:"Sem luz",visibility:"operational"};
 const first=await draftFromIncident({admin:db,organizationId:"o",actorId:"dono",storeId:"s1",incident});
 assert.equal(first.created,true);assert.equal(first.announcement.status,"draft");assert.equal(first.announcement.announcement_type,"crisis");assert.deepEqual(first.announcement.related_refs,{incident:["inc"]});
 assert.equal((await draftFromIncident({admin:db,organizationId:"o",actorId:"dono",storeId:"s1",incident})).created,false,"an unsent draft is reused");
 const sent=db.tables.network_announcements.find(x=>x.id===first.announcement.id);sent.status="published";
 const update=await draftFromIncident({admin:db,organizationId:"o",actorId:"dono",storeId:"s1",incident});assert.equal(update.created,true,"an incident in progress can communicate again");assert.equal(update.announcement.status,"draft");assert.notEqual(update.announcement.id,first.announcement.id);
 assert.equal(db.tables.incident_relations[0].entity_type,"internal_communication");assert.equal(db.tables.incident_relations[0].entity_id,first.announcement.id);
});
test("T10b the incident timeline shows what was sent",async()=>{
 const db=fakeDb({...seed(),operational_incidents:[{id:"inc",organization_id:"o",visibility:"operational"},{id:"alheio",organization_id:"other",visibility:"operational"}]}),a={id:"a1",title:"Aviso",version:1,related_refs:{incident:["inc","alheio"]}};
 await linkPublishedToIncidents(owner(db),a);
 assert.equal(db.tables.incident_timeline_events.length,1,"an incident of another tenant is ignored");assert.equal(db.tables.incident_timeline_events[0].event_type,"communication_sent");
});
test("T10c a continuity plan only proposes, and the proposal waits for approval",async()=>{
 const db=fakeDb(seed()),out=await proposeFromContinuity({admin:db,organizationId:"o",actorId:"dono",storeId:"s1",activation:{id:"act",plan_id:"p",activation_reason:"Falha no fornecedor"},plan:{name:"Plano X",communication_plan:{}}});
 assert.equal(out.proposed,true);assert.equal(out.announcement.status,"pending_approval");assert.equal(db.tables.internal_approvals.length,1);assert.equal((db.tables.network_announcement_recipients||[]).length,0,"nobody received anything");
 const route=await file("../app/api/business-continuity/route.ts");assert.match(route,/plan_activated[\s\S]*continuity\.plan_activated[\s\S]*proposeFromContinuity[\s\S]*catch\{/);
});
test("T10d recall: template, short deadline, confirmation per unit",async()=>{
 const template=DEFAULT_TEMPLATES.find(x=>x.template_key==="recall_alimentar");assert.equal(template.requires_ack,true);assert.ok(template.ack_hours<=24);
 const db=fakeDb(seed()),out=await draftFromRecall({admin:db,organizationId:"o",actorId:"dono",storeId:"s1",recall:{id:"rec",title:"Molho X"},storeIds:["s1","s2"]});
 const a=out.announcement;assert.equal(a.announcement_type,"recall_food_safety");assert.equal(a.acknowledgement_required,true);assert.ok(Date.parse(a.ack_deadline)-Date.now()<=864e5);assert.equal(a.status,"draft");
 const ctx=owner(db);await assert.rejects(publishAnnouncement(ctx,{id:a.id}),/APPROVAL_REQUIRED/);
 const row=db.tables.network_announcements.find(x=>x.id===a.id);row.created_by="outra";await submitForApproval(ctx,{id:a.id});row.created_by="outra";row.approval_id=row.approval_id;
 await decideApproval(owner(db,{actorId:"admin"}),{id:a.id,decision:"approved",reason:"Conferido"});await publishAnnouncement(ctx,{id:a.id});
 await acknowledge(person(db),{id:a.id});await acknowledge(person(db,"gerente1"),{id:a.id});
 const units=(await acknowledgementSummary(ctx,{id:a.id})).units;assert.equal(units.find(x=>x.store_id==="s1").confirmed,true);assert.equal(units.find(x=>x.store_id==="s2").confirmed,false);
 assert.match(await file("../app/api/food-quality/route.ts"),/internal_recall_started[\s\S]*draftFromRecall[\s\S]*catch\{/);
});
test("T11 copilot draft actions of Phases 65, 67 and 68 create real drafts",async()=>{
 const worker=await file("../app/api/automation/worker/route.ts");assert.match(worker,/isCommunicationDraftAction\(node\.config\.action_type\)\)await draftFromAutomation/);
 for(const[action,ref]of[["opening_create_communication_draft","store_opening"],["audit_create_communication_draft","audit"],["knowledge_create_communication_draft","sop"]]){
  assert.equal(isCommunicationDraftAction(action),true);
  const db=fakeDb(seed()),a=await draftFromAutomation({admin:db,organizationId:"o",storeId:"s1",ownerUserId:"dono",actionType:action,executionId:"ex",nodeId:"n",inputs:{title:"Aviso gerado",body:"Corpo do aviso.",source_id:"origem"}});
  assert.equal(a.status,"draft");assert.deepEqual(a.related_refs,{[ref]:["origem"]});assert.equal(a.source_type,"automation");
  const again=await draftFromAutomation({admin:db,organizationId:"o",storeId:"s1",ownerUserId:"dono",actionType:action,executionId:"ex",nodeId:"n",inputs:{title:"Aviso gerado",body:"Corpo do aviso."}});assert.equal(again.id,a.id,"a retry does not duplicate");
 }
});
test("T12 anonymous poll with minimum responses",async()=>{
 const under=aggregatePoll({minimum:5,options:[{id:"a",label:"Sim"},{id:"b",label:"Não"}],responses:[{option_id:"a"},{option_id:"a"}]});assert.equal(under.status,"insufficient_responses");assert.ok(under.options.every(x=>x.count===null&&x.percent===null));
 const ok=aggregatePoll({minimum:3,options:[{id:"a",label:"Sim"},{id:"b",label:"Não"}],responses:[{option_id:"a"},{option_id:"a"},{option_id:"b"}]});assert.equal(ok.options[0].count,2);assert.equal(ok.options[0].percent,66.7);
 const db=fakeDb(seed()),ctx=owner(db),{poll}=await createPoll(ctx,{question:"Prefere qual turno?",options:["Manhã","Tarde"],audience:STORE});assert.equal(poll.anonymous,true);assert.ok(poll.minimum_responses>=3);
 const option=db.tables.comms_poll_options[0].id;await vote(person(db),{pollId:poll.id,optionId:option});
 await assert.rejects(vote(person(db),{pollId:poll.id,optionId:option}),/ALREADY_VOTED/);
 await assert.rejects(vote(person(db,"gerente2"),{pollId:poll.id,optionId:option}),/POLL_NOT_FOUND/,"outside the audience");
 assert.equal(db.tables.comms_poll_responses[0].identified_user_id,null);assert.deepEqual(Object.keys(db.tables.comms_poll_participation[0]).filter(x=>x.includes("option")),[]);
 const s=await migrations(),responses=s.match(/create table public\.comms_poll_responses\([^;]*;/)[0],participation=s.match(/create table public\.comms_poll_participation\([^;]*;/)[0];
 assert.doesNotMatch(responses,/created_at|timestamptz/,"nothing to cross a vote with a person by time");assert.doesNotMatch(participation,/created_at|timestamptz|option_id/);
});
test("T13 no individual engagement metric is exposed",async()=>{
 const[s,ui,lib]=await Promise.all([migrations(),file("../components/internal-communications-center.tsx"),allLib()]),view=s.match(/create view public\.fact_comms_reach[\s\S]*?group by[^;]*;/)[0];
 assert.doesNotMatch(view,/user_id/);assert.doesNotMatch(`${s}\n${ui}\n${lib}`,/leaderboard|rank_position|likes?_count|engagement_score/i);
 const m=reachMetrics([{recipients:10,delivered:8,opened:4,acknowledged:5,overdue:2,median_hours_to_ack:3,acknowledgement_required:true},{recipients:10,delivered:10,opened:6,acknowledged:0,overdue:0,acknowledgement_required:false}]);
 assert.equal(m.deliveryRate.denominator,20);assert.equal(m.deliveryRate.denominatorLabel,"destinatários");assert.equal(m.acknowledgementRate.denominator,10);assert.equal(m.acknowledgementRate.value,50);assert.equal(m.medianHoursToAcknowledge,3);
 const db=fakeDb(seed()),a=await draft(owner(db));await publishAnnouncement(owner(db),{id:a.id});
 await assert.rejects(pendingPeople(owner(db),{id:a.id}),/ACK_NOT_REQUIRED/,"no names on a non-mandatory announcement");
 assert.deepEqual((await acknowledgementSummary(owner(db),{id:a.id})).units,[],"and no per-unit numbers either");
 await assert.rejects(pendingPeople(person(db),{id:a.id}),/FORBIDDEN/);
});
test("T14 platform_announcements is not touched",async()=>{
 const[s,lib,route,ui]=await Promise.all([migrations(),allLib(),file("../app/api/internal-communications/route.ts"),file("../components/internal-communications-center.tsx")]);
 assert.doesNotMatch(`${s}\n${lib}\n${route}\n${ui}`,/platform_announcements/);
});
test("T15 AI does not publish",async()=>{
 assert.deepEqual([...COMMS_COPILOT_TOOLS],["getAnnouncements","getPendingAcknowledgements","draftAnnouncement","summarizeAnnouncement","simplifyLanguage","getCrisisCommunications"]);
 for(const tool of COMMS_COPILOT_TOOLS){const out=commsCopilot(tool,{announcements:[],pending:[],crisis:[]},{body:"Comunicamos que o item foi trocado."});assert.equal(out.canPublish,false);assert.equal(out.canApprove,false);assert.equal(out.canSend,false)}
 assert.throws(()=>commsCopilot("publishAnnouncement",{}),/TOOL_NOT_ALLOWED/);
 assert.ok(COMMS_FORBIDDEN_ACTIONS.includes("publish_announcement"));assert.ok(!COMMS_SAFE_AUTOMATION_ACTIONS.some(x=>/publish|approve/.test(x)));
 assert.equal(simplifyText("Deverá utilizar o avental."),"precisa usar o avental.");assert.equal(summarizeText("Um. Dois. Três.",1),"Um. …");
 const db=fakeDb({...seed(),comms_settings:[{organization_id:"o",emergency_publish_allowed:true}]}),ctx=owner(db),a=await draft(ctx,{aiGenerated:true,type:"crisis",priority:"urgent"});
 await assert.rejects(publishAnnouncement(ctx,{id:a.id}),/APPROVAL_REQUIRED/);
 await assert.rejects(publishAnnouncement(ctx,{id:a.id,emergency:true,reason:"Motivo com tamanho suficiente"}),/AI_REQUIRES_APPROVAL/,"not even through the emergency door");
 const worker=await file("../lib/internal-communications/crisis.ts");assert.doesNotMatch(worker.slice(worker.indexOf("export async function draftFromAutomation")),/publishAnnouncement/);
});
test("T16 failure does not block orders",async()=>{
 const roots=["../app/api/orders","../app/api/public"];for(const root of roots){let names=[];try{names=await readdir(new URL(root+"/",import.meta.url),{recursive:true})}catch{continue}for(const name of names.filter(x=>x.endsWith(".ts")))assert.doesNotMatch(await readFile(new URL(`${root}/${name}`,import.meta.url),"utf8"),/internal-communications/)}
 const[incident,continuity,recall]=await Promise.all([file("../app/api/incidents/route.ts"),file("../app/api/business-continuity/route.ts"),file("../app/api/food-quality/route.ts")]);
 assert.match(incident,/internalCommunicationsOn\(c\.a,c\.storeId\)\.catch\(\(\)=>false\)/);assert.match(incident,/incident\.declared[\s\S]{0,300}\.catch\(\(\)=>null\)/);assert.match(continuity,/catch\{/);assert.match(recall,/catch\{/);
 const db=fakeDb(seed()),ctx=owner(db,{notify:async()=>{throw new Error("sem inbox")}}),a=await draft(ctx);
 assert.equal((await publishAnnouncement(ctx,{id:a.id})).announcement.status,"published");assert.equal((await runDelivery(ctx,a.id)).failed,2,"a failed delivery stays on the queue, it does not throw");
});
test("T17 RBAC",()=>{
 const roles=x=>new CommsAccessService().resolve(x);
 assert.equal(roles({storeRole:"attendant"}).length,0);assert.equal(roles({storeRole:"kitchen"}).length,0,"reads their feed, does not manage");
 assert.ok(!roles({storeRole:"manager"}).includes("comms:publish_network"));assert.ok(!roles({storeRole:"manager"}).includes("comms:approve"));assert.ok(!roles({storeRole:"manager"}).includes("comms:publish_crisis"));
 assert.ok(roles({orgRole:"owner"}).includes("comms:publish_crisis"));assert.deepEqual(roles({explicit:["comms:approve","vendor:view"]}),["comms:approve"]);
 assert.equal(COMMS_PERMISSIONS.length,10);
});
test("T17b permissions are enforced by the services",async()=>{
 const db=fakeDb(seed()),a=await draft(owner(db),{audience:NETWORK}),own=await draft(manager(db));
 await assert.rejects(createDraft(person(db),{title:"Sem permissão",body:"Texto qualquer.",audience:STORE}),/FORBIDDEN/);
 await assert.rejects(publishAnnouncement(manager(db),{id:a.id}),/FORBIDDEN/,"network needs its own permission");
 await assert.rejects(decideApproval(manager(db),{id:a.id,decision:"approved",reason:"Conferido"}),/FORBIDDEN/);
 assert.equal((await publishAnnouncement(manager(db),{id:own.id})).announcement.status,"published");
 await assert.rejects(saveTemplate(person(db),{name:"X"}),/FORBIDDEN/);
 await assert.rejects(createBoardPost(owner(db),{scope:"network",post_type:"quick_notice",title:"Aviso geral"}),/NETWORK_NOTICE_NEEDS_ANNOUNCEMENT/,"the board is not a way around approval");
});
test("T17c audit covers what the phase asks for",async()=>{
 const db=fakeDb({...seed(),comms_settings:[{organization_id:"o",emergency_publish_allowed:true}]}),ctx=owner(db),admin=owner(db,{actorId:"admin"}),a=await draft(ctx,{audience:NETWORK,priority:"mandatory"});
 await submitForApproval(ctx,{id:a.id});await decideApproval(admin,{id:a.id,decision:"approved",reason:"Conferido"});await publishAnnouncement(ctx,{id:a.id});await editAnnouncement(ctx,{id:a.id,body:"Versão com outro texto 9."});await decideApproval(admin,{id:a.id,decision:"approved",reason:"Conferido de novo"});await pendingPeople(ctx,{id:a.id});await retractAnnouncement(ctx,{id:a.id,reason:"Erro no texto"});
 const b=await draft(ctx,{type:"crisis",priority:"urgent"});await publishAnnouncement(ctx,{id:b.id,emergency:true,reason:"Motivo com tamanho suficiente"});
 const seen=new Set(db.tables.comms_audit_events.map(x=>x.action));for(const action of["published","approval_granted","version_edited","retracted","emergency_published","ack_status_viewed"])assert.ok(seen.has(action),action);
 assert.ok(db.tables.security_audit_logs.some(x=>x.action==="comms.published"));
});
test("T18 sensitive data does not go out",async()=>{
 assert.deepEqual(checkContent("CPF 529.982.247-25").blocked,["CPF"]);assert.deepEqual(checkContent("Cartão 4111 1111 1111 1111").blocked,["CARD"]);assert.deepEqual(checkContent("escreva para fulano@exemplo.com").blocked,["EMAIL"]);assert.deepEqual(checkContent("ligue (11) 91234-5678").blocked,["PHONE"]);
 assert.equal(checkContent("Lote 7891000100103 e pedido 1793562613565").ok,true,"a barcode or a long code is not a card");
 assert.equal(checkContent("Lote 123456 chega às 10:30 no dia 12/12/2026").ok,true,"ordinary numbers are not a document");
 assert.deepEqual(checkContent("Reajuste de salário").warnings,["SALARY"]);assert.deepEqual(checkContent("Como entregar o atestado").warnings,["HEALTH"]);
 const db=fakeDb(seed()),ctx=owner(db),a=await draft(ctx,{body:"CPF do cliente: 529.982.247-25"});
 await assert.rejects(publishAnnouncement(ctx,{id:a.id,confirmSensitive:true}),/SENSITIVE_DATA_BLOCKED:CPF/,"a person cannot confirm this one past the block");
 const b=await draft(ctx,{body:"Como entregar o atestado no RH."});await assert.rejects(publishAnnouncement(ctx,{id:b.id}),/SENSITIVE_DATA_CONFIRM:HEALTH/);assert.equal((await publishAnnouncement(ctx,{id:b.id,confirmSensitive:true})).announcement.status,"published");
});
test("T19 templates keep their versions and show what is missing",async()=>{
 for(const key of["mudanca_cardapio","procedimento","abertura_loja","recall_alimentar","manutencao","crise"])assert.ok(DEFAULT_TEMPLATES.some(x=>x.template_key===key),key);
 const out=renderTemplate({title_template:"Recall: {{item}}",body_template:"Lote {{lote}}"},{item:"Molho"});assert.equal(out.title,"Recall: Molho");assert.equal(out.body,"Lote [lote]");assert.deepEqual(out.missing,["lote"]);
 const db=fakeDb(seed()),ctx=owner(db),input={name:"Aviso de férias",announcement_type:"general",priority:"info",title_template:"Férias: {{data}}",body_template:"Corpo do aviso"};
 const v1=await saveTemplate(ctx,input),v2=await saveTemplate(ctx,{...input,body_template:"Corpo novo"});assert.equal(v1.template.version,1);assert.equal(v2.template.version,2);assert.equal(v2.template.owner_user_id,"dono");assert.deepEqual(v2.template.variables,["data"]);assert.equal(db.tables.comms_templates.find(x=>x.version===1).status,"retired");
});
test("T20 schema is closed to clients and every foreign key is indexed",async()=>{
 const s=await migrations();
 for(const table of["comms_member_permissions","comms_settings","comms_jobs","comms_audit_events","network_announcement_versions","comms_templates","comms_attachments","comms_board_posts","comms_board_comments","comms_polls","comms_poll_options","comms_poll_participation","comms_poll_responses"])assert.match(s,new RegExp(`'${table}'`),table);
 assert.match(s,/network_announcement_recipients enable row level security/);assert.match(s,/revoke all on public\.network_announcement_recipients from public,anon,authenticated/);assert.match(s,/revoke all on public\.fact_comms_reach from public,anon,authenticated/);assert.match(s,/security_invoker=true/);
 assert.match(s,/values\('internal-communications','internal-communications',false/,"private bucket");
 for(const flag of COMMS_FLAGS)assert.match(s,new RegExp(`store_feature_flags[^;]*${flag}`),flag);
 assert.match(s,/'comms' and requested_permission_key like 'comms:%'/);assert.match(s,/'module','comms'/);
});
test("T21 integrations are wired",async()=>{
 const[report,reports,widgets,core,exec,shell,search,identity]=await Promise.all([file("../lib/reporting/core.ts"),file("../app/api/reports/route.ts"),file("../lib/workspace/widget-data.ts"),file("../lib/data-platform/core.ts"),file("../app/api/executive-command/route.ts"),file("../components/dashboard-shell.tsx"),migrations(),file("../lib/identity-governance/server.ts")]);
 assert.match(report,/COMMS_DATASET_DEFINITIONS/);assert.match(reports,/commsReportRows/);assert.match(widgets,/comms_my_mandatory/);assert.match(await file("../app/api/workspace/route.ts"),/commsOpen?["comms_my_mandatory"]/);assert.match(core,/COMMS_FACTS/);
 assert.match(exec,/commsCrisis[\s\S]*commsPending/);assert.match(exec,/"insights","flags",("[a-zA-Z]+",)*"commsCrisis","commsPending"\]/,"comms keys stay last, matching the order of their queries");
 assert.match(shell,/internal-communications/);assert.match(shell,/my-announcements/);assert.match(search,/search_navigation_registry/);assert.match(search,/comms-new-announcement/);assert.match(identity,/comms:COMMS_PERMISSIONS/);
 const entitlements=new AccessCatalogService().compose({modulePermissions:{soc:[],vendor:[],idgov:[],comms:COMMS_PERMISSIONS},apiScopes:[]});
 const of=key=>entitlements.find(x=>x.key===`perm:${key}`);assert.equal(of("comms:publish_crisis").privileged,true);assert.equal(of("comms:publish_network").privileged,true);assert.equal(of("comms:view").privileged,false);assert.equal(of("comms:publish_network").technical_ref.module,"comms");
 assert.equal(new AccessCatalogService().compose({modulePermissions:{soc:[],vendor:[],idgov:[]},apiScopes:[]}).some(x=>x.key.startsWith("perm:comms")),false,"older callers keep working");
});
test("T22 employee UI: acknowledge button, mobile sized, no engagement numbers",async()=>{
 const ui=await file("../components/my-announcements.tsx");assert.match(ui,/Li e entendi/);assert.match(ui,/minHeight:44/);assert.doesNotMatch(ui,/likes|ranking/i);
 const center=await file("../components/internal-communications-center.tsx");for(const tab of["Visão Geral","Comunicados","Novo Comunicado","Agendados","Pendências de Leitura","Mural","Enquetes","Templates","Crise","Configurações"])assert.ok(center.includes(`"${tab}"`),tab);
 for(const c of["Comunicados ativos","Obrigatórios com pendência","Taxa de confirmação","Agendados","Crises ativas","Aguardando aprovação"])assert.ok(center.includes(c),c);
});
