/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CustomerHealthService, CustomerIdentityMergeService, CustomerNextBestActionService, CustomerProductAffinityService, CustomerRelationshipMetricsService, lifecycleFor, maskPhone, safeTimelineMetadata } from "@/lib/customer-360/core";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FULL=["customer360:view","customer360:view_contact","customer360:view_support","customer360:view_marketing","customer360:view_value","customer360:view_network","customer360:manage_preferences","customer360:merge_identity","customer360:view_health","customer360:manage_notes"];
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"cache-control":"private, no-store"}});

async function context(storeId:string){
  if(!UUID.test(storeId)) throw new Error("FORBIDDEN");
  const client=await createClient(),{data}=await client.auth.getClaims(),userId=String(data?.claims?.sub||"");
  if(!userId) throw new Error("AUTH");
  const admin=createAdminClient(),{data:store}=await admin.from("establishments").select("id,organization_id,name").eq("id",storeId).single();
  if(!store) throw new Error("FORBIDDEN");
  const [{data:local},{data:org},{data:custom}]=await Promise.all([
    admin.from("establishment_members").select("role").eq("establishment_id",storeId).eq("user_id",userId).eq("status","active").maybeSingle(),
    admin.from("organization_members").select("role,all_stores").eq("organization_id",store.organization_id).eq("user_id",userId).eq("active",true).maybeSingle(),
    admin.from("customer360_member_permissions").select("permissions").eq("organization_id",store.organization_id).eq("user_id",userId).eq("active",true)
  ]);
  if(!local&&!org) throw new Error("FORBIDDEN");
  const role=String(org?.role||local?.role||"member"),permissions=new Set<string>();
  if(["owner","admin","manager","supervisor"].includes(role)) FULL.forEach(x=>permissions.add(x));
  for(const row of custom||[]) for(const permission of row.permissions||[]) permissions.add(permission);
  return {client,admin,userId,storeId,organizationId:store.organization_id,permissions,network:Boolean(org?.all_stores)&&permissions.has("customer360:view_network")};
}
function requirePermission(c:any,permission:string){if(!c.permissions.has(permission))throw new Error("FORBIDDEN")}
async function storeIds(c:any){if(!c.network)return[c.storeId];const{data}=await c.admin.from("establishments").select("id").eq("organization_id",c.organizationId);return(data||[]).map((x:any)=>x.id)}
async function loadCustomer(c:any,id:string){const stores=await storeIds(c);const{data}=await c.admin.from("customers").select("*").eq("id",id).in("establishment_id",stores).maybeSingle();if(!data)throw new Error("FORBIDDEN");return data}
async function audit(c:any,action:string,customerId:string|null,reason?:string,before?:unknown,after?:unknown){await c.admin.from("customer360_audit_events").insert({organization_id:c.organizationId,customer_id:customerId,actor_user_id:c.userId,action,reason:reason||null,before_state:before||null,after_state:after||null})}
async function consent(c:any,customerId:string){const[{data:preference},{data:events}]=await Promise.all([c.admin.from("customer_notification_preferences").select("transactional_enabled,whatsapp_marketing,email_marketing,preferred_channel,updated_at").eq("organization_id",c.organizationId).eq("customer_id",customerId).maybeSingle(),c.admin.from("crm_consent_events").select("status,channel,origin,created_at").eq("customer_id",customerId).order("created_at",{ascending:false}).limit(20)]);const latest=new Map<string,any>();for(const e of events||[])if(!latest.has(e.channel))latest.set(e.channel,e);return{preference,events:events||[],effective:{whatsapp:preference?.whatsapp_marketing===true&&latest.get("whatsapp")?.status!=="opted_out",email:preference?.email_marketing===true&&latest.get("email")?.status!=="opted_out"}}}

export async function GET(req:Request){
  try{
    const url=new URL(req.url),c=await context(String(url.searchParams.get("store_id")||""));requirePermission(c,"customer360:view");
    const id=url.searchParams.get("customer_id"),tab=url.searchParams.get("tab")||"overview",cursor=url.searchParams.get("cursor");
    if(!id){
      const stores=await storeIds(c),limit=Math.min(50,Math.max(10,Number(url.searchParams.get("limit")||25))),search=String(url.searchParams.get("search")||"").trim().toLowerCase(),filter=url.searchParams.get("filter")||"all";
      let query=c.admin.from("customers").select("id,establishment_id,name,phone,email,last_order_at,total_orders,total_spent_cents,created_at").in("establishment_id",stores).order("created_at",{ascending:false}).limit(limit+1);if(cursor)query=query.lt("created_at",cursor);
      const{data,error}=await query;if(error)throw error;let rows=data||[];if(search)rows=rows.filter((x:any)=>`${x.name} ${x.phone} ${x.email||""}`.toLowerCase().includes(search));
      const ids=rows.map((x:any)=>x.id),{data:summaries}=ids.length?await c.admin.from("customer_360_summaries").select("*").eq("organization_id",c.organizationId).in("customer_id",ids):{data:[]},map=new Map((summaries||[]).map((x:any)=>[x.customer_id,x]));
      let customers=rows.map((x:any)=>({...x,phone:maskPhone(x.phone,c.permissions.has("customer360:view_contact")),email:c.permissions.has("customer360:view_contact")?x.email:null,summary:map.get(x.id)||null}));
      if(filter!=="all")customers=customers.filter((x:any)=>x.summary?.lifecycle_stage===filter||x.summary?.health_level===filter||x.summary?.relationship_value_band===filter||(filter==="loyalty"&&x.summary?.loyalty_status));
      return reply({customers:customers.slice(0,limit),nextCursor:rows.length>limit?rows[limit-1]?.created_at:null,scope:c.network?"network":"store",permissions:[...c.permissions],filters:["new","repeat","dormant","at_risk","loyalty"],freshness:new Date().toISOString()});
    }
    const customer=await loadCustomer(c,id);
    if(tab==="timeline"){
      let query=c.admin.from("customer360_timeline_index").select("*").eq("organization_id",c.organizationId).eq("customer_id",id).order("occurred_at",{ascending:false}).order("id",{ascending:false}).limit(50);if(cursor)query=query.lt("occurred_at",cursor);
      const{data}=await query;return reply({events:(data||[]).map((event:any)=>({...event,metadata_safe:safeTimelineMetadata(event.metadata_safe||{})})),nextCursor:data?.at(-1)?.occurred_at||null,contentPolicy:"Somente resumo seguro e link para a fonte; conversas integrais não são copiadas.",eventualConsistency:true});
    }
    const{data:orders}=await c.admin.from("orders").select("id,establishment_id,status,fulfillment_type,total_cents,created_at,updated_at").eq("customer_id",id).order("created_at",{ascending:false}).limit(100),orderIds=(orders||[]).map((x:any)=>x.id);
    const sources=await Promise.all([
      orderIds.length?c.admin.from("order_items").select("product_id,product_name,quantity,order_id").in("order_id",orderIds):Promise.resolve({data:[]}),
      c.admin.from("customer_360_summaries").select("*").eq("organization_id",c.organizationId).eq("customer_id",id).maybeSingle(),
      c.admin.from("customer_identities").select("identity_type,verified,is_primary,verification_source,created_at").eq("organization_id",c.organizationId).eq("customer_id",id),
      c.admin.from("crm_customer_tags").select("created_at,crm_tags(id,name,color,automatic)").eq("customer_id",id),
      c.admin.from("loyalty_accounts").select("*").eq("customer_id",id).maybeSingle(),
      c.admin.from("loyalty_ledger").select("*").eq("customer_id",id).order("created_at",{ascending:false}).limit(30),
      c.admin.from("reservations").select("id,status,starts_at,party_size,source,created_at").eq("customer_id",id).order("starts_at",{ascending:false}).limit(30),
      c.admin.from("customer_subscriptions").select("id,status,current_period_start,current_period_end,created_at,plan_id").eq("customer_id",id).order("created_at",{ascending:false}).limit(20),
      c.admin.from("customer_support_requests").select("id,status,category,details,created_at,updated_at").eq("customer_id",id).order("created_at",{ascending:false}).limit(30),
      c.admin.from("crm_feedback").select("id,rating,comment,needs_human_attention,answered_at,created_at").eq("customer_id",id).order("created_at",{ascending:false}).limit(30),
      c.admin.from("crm_campaign_recipients").select("status,sent_at,delivered_at,read_at,created_at,crm_campaigns(id,name,status)").eq("customer_id",id).order("created_at",{ascending:false}).limit(30),
      c.admin.from("omnichannel_conversations").select("id,current_channel,status,operational_status,last_message_preview,last_message_at,created_at").eq("customer_id",id).order("last_message_at",{ascending:false}).limit(30),
      c.admin.from("customer360_preferences").select("*").eq("organization_id",c.organizationId).eq("customer_id",id).eq("active",true),
      c.admin.from("customer360_notes").select("id,note_type,content,visibility,created_at,updated_at").eq("organization_id",c.organizationId).eq("customer_id",id).is("archived_at",null).order("created_at",{ascending:false}),
      c.admin.from("customer_privacy_requests").select("id,request_type,status,created_at,updated_at").eq("organization_id",c.organizationId).eq("customer_id",id).order("created_at",{ascending:false}),
      c.admin.from("internal_tasks").select("id,title,status,priority,due_at,created_at").eq("source_type","customer360_profile").eq("source_id",id).not("status","in",'("done","cancelled","archived")'),
      c.admin.from("customer_journey_enrollments").select("id,status,entered_at,next_action_at,customer_journeys(id,name,objective,status)").eq("organization_id",c.organizationId).eq("customer_id",id).in("status",["active","waiting","paused"]),consent(c,id)
    ]);
    const [items,summary,identities,tags,loyalty,ledger,reservations,subscriptions,support,feedback,campaigns,conversations,preferences,notes,privacy,tasks,activeJourneys,consents]=sources.map((x:any)=>x.data===undefined?x:x.data);
    const metrics=CustomerRelationshipMetricsService.calculate((orders||[]).map((x:any)=>({id:x.id,createdAt:x.created_at,totalCents:x.total_cents,status:x.status,channel:x.fulfillment_type,storeId:x.establishment_id}))),affinity=CustomerProductAffinityService.rank((items||[]).map((x:any)=>({productId:x.product_id||x.product_name,productName:x.product_name,quantity:x.quantity}))),openComplaints=(feedback||[]).filter((x:any)=>x.needs_human_attention).length+(support||[]).filter((x:any)=>!["closed","resolved"].includes(x.status)).length;
    const health=CustomerHealthService.evaluate({ordersCount:metrics.ordersCount,daysSinceLastOrder:metrics.daysSinceLastOrder,openComplaints,subscriptionProblem:(subscriptions||[]).some((x:any)=>["past_due","payment_failed"].includes(x.status)),loyaltyActive:Boolean(loyalty)}),nextBest=CustomerNextBestActionService.suggest({openComplaint:openComplaints>0,activeRecovery:false,marketingOptIn:consents.effective.whatsapp||consents.effective.email,quietHours:false,frequencyCapReached:false,loyaltyActive:Boolean(loyalty),ordersCount:metrics.ordersCount});
    return reply({customer:{...customer,phone:maskPhone(customer.phone,c.permissions.has("customer360:view_contact")),email:c.permissions.has("customer360:view_contact")?customer.email:null},summary:summary||{...metrics,lifecycle_stage:lifecycleFor({ordersCount:metrics.ordersCount,daysSinceLastOrder:metrics.daysSinceLastOrder,loyaltyActive:Boolean(loyalty)}),health_level:health.level},metrics:c.permissions.has("customer360:view_value")?metrics:{ordersCount:metrics.ordersCount,lastOrderAt:metrics.lastOrderAt},identities,tags,orders,affinity,loyalty:{account:loyalty,ledger:ledger||[]},reservations,subscriptions,support:c.permissions.has("customer360:view_support")?support:[],feedback:c.permissions.has("customer360:view_support")?feedback:[],campaigns:c.permissions.has("customer360:view_marketing")?campaigns:[],conversations:c.permissions.has("customer360:view_support")?conversations:[],preferences,notes,health:c.permissions.has("customer360:view_health")?health:null,nextBest:c.permissions.has("customer360:view_health")?nextBest:null,activeJourneys:activeJourneys||[],consents,privacy,tasks,labels:{affinity:"Padrão de compra observado; não preferência pessoal declarada.",value:"Receita acumulada não representa lucro.",risk:"Regra determinística explicada; não verdade absoluta."},sourceOfTruthPreserved:true,dataAsOf:summary?.data_as_of||new Date().toISOString()});
  }catch(error:any){const message=error?.message||"Falha";return reply({error:message},message==="AUTH"?401:message==="FORBIDDEN"?403:500)}
}

export async function POST(req:Request){
  try{
    const body=await req.json(),c=await context(String(body.store_id||"")),action=String(body.action||"");requirePermission(c,"customer360:view");
    if(action==="merge_preview"){
      requirePermission(c,"customer360:merge_identity");await Promise.all([loadCustomer(c,body.source_customer_id),loadCustomer(c,body.target_customer_id)]);
      const{data,error}=await c.client.rpc("preview_customer_merge",{requested_establishment_id:c.storeId,requested_source_customer_id:body.source_customer_id,requested_target_customer_id:body.target_customer_id});if(error)throw error;
      const preview=CustomerIdentityMergeService.preview({id:body.source_customer_id,organizationId:c.organizationId,counts:{orders:Number(data?.orders||0)}},{id:body.target_customer_id,organizationId:c.organizationId,counts:{}}),{data:operation}=await c.admin.from("customer360_merge_operations").insert({organization_id:c.organizationId,store_id:c.storeId,source_customer_id:body.source_customer_id,target_customer_id:body.target_customer_id,preview:{canonical:data,summary:preview},rollback_snapshot:{prepared:true},requested_by:c.userId}).select().single();
      await audit(c,"identity_merge_preview",body.target_customer_id,body.reason,undefined,{operation_id:operation?.id});return reply({operation,preview,canonicalPreview:data},201);
    }
    if(action==="merge_execute"){
      requirePermission(c,"customer360:merge_identity");if(!body.human_confirmed||!body.reason)return reply({error:"Mesclagem exige confirmação humana e motivo."},409);
      const{data:operation}=await c.admin.from("customer360_merge_operations").select("*").eq("id",body.operation_id).eq("organization_id",c.organizationId).eq("status","preview").single(),{data,error}=await c.client.rpc("merge_customers_omnichannel",{requested_establishment_id:c.storeId,requested_source_customer_id:operation.source_customer_id,requested_target_customer_id:operation.target_customer_id,requested_confirm:true});if(error)throw error;
      await c.admin.from("customer360_merge_operations").update({status:"merged",confirmed_by:c.userId,confirmed_at:new Date().toISOString(),merge_audit_id:data,completed_at:new Date().toISOString()}).eq("id",operation.id);await audit(c,"identity_merged",operation.target_customer_id,body.reason,operation,{merge_audit_id:data});return reply({merged:true,mergeAuditId:data,automatic:false,rollbackPrepared:true});
    }
    const customer=await loadCustomer(c,String(body.customer_id||""));
    if(action==="set_preference"){
      requirePermission(c,"customer360:manage_preferences");if(["health","religion","ethnicity","politics","psychology"].includes(String(body.preference_type)))return reply({error:"Preferência sensível não permitida."},400);
      const{data,error}=await c.admin.from("customer360_preferences").upsert({organization_id:c.organizationId,customer_id:customer.id,preference_type:body.preference_type,value:body.value,origin:body.origin||"staff_recorded",observed_label:["category_pattern","product_pattern"].includes(body.preference_type),active:true,created_by:c.userId,updated_at:new Date().toISOString()},{onConflict:"organization_id,customer_id,preference_type"}).select().single();if(error)throw error;await audit(c,"preference_changed",customer.id,body.reason,undefined,data);return reply({preference:data,onlineRequired:true});
    }
    if(action==="change_consent"){
      requirePermission(c,"customer360:manage_preferences");const channel=String(body.channel||"");if(!["whatsapp","email"].includes(channel))return reply({error:"Canal inválido."},400);const enabled=Boolean(body.enabled),patch=channel==="whatsapp"?{whatsapp_marketing:enabled}:{email_marketing:enabled};
      const{error}=await c.admin.from("customer_notification_preferences").upsert({organization_id:c.organizationId,customer_id:customer.id,...patch,updated_at:new Date().toISOString()},{onConflict:"organization_id,customer_id"});if(error)throw error;await c.admin.from("crm_consent_events").insert({establishment_id:c.storeId,customer_id:customer.id,channel,status:enabled?"opted_in":"opted_out",origin:"admin",actor_id:c.userId,evidence:{reason:body.reason||"Atualização manual auditada",source:"customer360"}});await audit(c,"consent_changed",customer.id,body.reason,undefined,{channel,enabled});return reply({consentUpdated:true,channel,enabled,optOutImmediate:!enabled});
    }
    if(action==="add_note"){
      requirePermission(c,"customer360:manage_notes");if(!body.policy_acknowledged)return reply({error:"Confirme a política de notas sem dados sensíveis ou discriminatórios."},409);const{data,error}=await c.admin.from("customer360_notes").insert({organization_id:c.organizationId,customer_id:customer.id,store_id:c.storeId,note_type:body.note_type||"service",content:String(body.content||"").slice(0,1000),policy_acknowledged:true,visibility:"restricted",created_by:c.userId}).select().single();if(error)throw error;await audit(c,"note_created",customer.id,body.reason,undefined,{id:data.id});return reply({note:data,notUsedForAutomaticDecisions:true},201);
    }
    if(action==="create_task"){
      const{data,error}=await c.admin.from("internal_tasks").insert({title:body.title||`Acompanhar cliente ${customer.name}`,description:body.description||"Tarefa criada a partir do Perfil 360.",status:"backlog",priority:body.priority||"normal",assigned_to_user_id:body.assigned_to_user_id||null,created_by_user_id:c.userId,due_at:body.due_at||null,task_type:"follow_up",source_type:"customer360_profile",source_id:customer.id}).select().single();if(error)throw error;await audit(c,"task_created",customer.id,body.reason,undefined,{task_id:data.id});return reply({task:data,canonicalTaskEngine:true},201);
    }
    if(action==="add_tag"){
      requirePermission(c,"customer360:view_marketing");const{error}=await c.admin.from("crm_customer_tags").upsert({establishment_id:c.storeId,customer_id:customer.id,tag_id:body.tag_id,source:"manual",created_by:c.userId},{onConflict:"customer_id,tag_id"});if(error)throw error;await audit(c,"tag_added",customer.id,body.reason,undefined,{tag_id:body.tag_id});return reply({tagAdded:true,canonicalCrm:true});
    }
    return reply({error:"Ação inválida."},400);
  }catch(error:any){const message=error?.message||"Falha";return reply({error:message},message==="AUTH"?401:message==="FORBIDDEN"?403:400)}
}
