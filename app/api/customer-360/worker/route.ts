/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CustomerHealthService, CustomerRelationshipMetricsService, lifecycleFor } from "@/lib/customer-360/core";

export async function POST(req:Request){
  const secret=process.env.CUSTOMER360_WORKER_SECRET||process.env.CRON_SECRET;
  if(!secret||req.headers.get("authorization")!==`Bearer ${secret}`)return NextResponse.json({error:"Unauthorized"},{status:401});
  const admin=createAdminClient(),now=new Date(),{data:jobs,error}=await admin.from("customer360_refresh_jobs").select("*").eq("status","pending").lte("available_at",now.toISOString()).order("created_at").limit(20);
  if(error)return NextResponse.json({error:error.message},{status:500});
  let completed=0,failed=0;
  for(const job of jobs||[]){
    const lease=await admin.from("customer360_refresh_jobs").update({status:"leased",leased_until:new Date(Date.now()+60000).toISOString(),attempts:job.attempts+1}).eq("id",job.id).eq("status","pending").select().maybeSingle();if(!lease.data)continue;
    try{
      if(job.customer_id&&job.job_type==="timeline"){
        const[{data:customer},{data:orders},{data:support},{data:reservations}]=await Promise.all([
          admin.from("customers").select("id,establishment_id").eq("id",job.customer_id).single(),
          admin.from("orders").select("id,status,total_cents,created_at,updated_at,establishment_id").eq("customer_id",job.customer_id).order("created_at",{ascending:false}).limit(100),
          admin.from("customer_support_requests").select("id,status,category,created_at,updated_at,establishment_id").eq("customer_id",job.customer_id).order("created_at",{ascending:false}).limit(50),
          admin.from("reservations").select("id,status,starts_at,created_at,updated_at,establishment_id").eq("customer_id",job.customer_id).order("created_at",{ascending:false}).limit(50)
        ]);if(!customer)throw new Error("CUSTOMER_NOT_FOUND");
        const events=[...(orders||[]).map((x:any)=>({organization_id:job.organization_id,customer_id:job.customer_id,store_id:x.establishment_id,event_type:"order",occurred_at:x.created_at,source_type:"orders",source_id:x.id,title:"Pedido",summary:`${x.status} · R$ ${(x.total_cents/100).toFixed(2)}`,metadata_safe:{status:x.status,total_cents:x.total_cents},source_updated_at:x.updated_at,indexed_at:now.toISOString()})),...(support||[]).map((x:any)=>({organization_id:job.organization_id,customer_id:job.customer_id,store_id:x.establishment_id,event_type:"support",occurred_at:x.created_at,source_type:"customer_support_requests",source_id:x.id,title:"Atendimento",summary:`${x.category} · ${x.status}`,metadata_safe:{status:x.status,category:x.category},source_updated_at:x.updated_at,indexed_at:now.toISOString()})),...(reservations||[]).map((x:any)=>({organization_id:job.organization_id,customer_id:job.customer_id,store_id:x.establishment_id,event_type:"reservation",occurred_at:x.created_at,source_type:"reservations",source_id:x.id,title:"Reserva",summary:x.status,metadata_safe:{status:x.status,starts_at:x.starts_at},source_updated_at:x.updated_at,indexed_at:now.toISOString()}))];
        if(events.length){const{error:timelineError}=await admin.from("customer360_timeline_index").upsert(events,{onConflict:"organization_id,source_type,source_id,event_type"});if(timelineError)throw timelineError}
      }
      if(job.customer_id&&["summary","health","analytics"].includes(job.job_type)){
        const[{data:customer},{data:orders},{data:loyalty},{data:support},{data:subscriptions}]=await Promise.all([
          admin.from("customers").select("id,establishment_id").eq("id",job.customer_id).single(),
          admin.from("orders").select("id,status,total_cents,created_at,fulfillment_type,establishment_id").eq("customer_id",job.customer_id).order("created_at"),
          admin.from("loyalty_accounts").select("balance").eq("customer_id",job.customer_id).maybeSingle(),
          admin.from("customer_support_requests").select("id,status").eq("customer_id",job.customer_id),
          admin.from("customer_subscriptions").select("id,status").eq("customer_id",job.customer_id)
        ]);
        if(!customer)throw new Error("CUSTOMER_NOT_FOUND");
        const metrics=CustomerRelationshipMetricsService.calculate((orders||[]).map((x:any)=>({id:x.id,status:x.status,totalCents:x.total_cents,createdAt:x.created_at,channel:x.fulfillment_type,storeId:x.establishment_id})),now),openCases=(support||[]).filter((x:any)=>!["closed","resolved"].includes(x.status)).length,health=CustomerHealthService.evaluate({ordersCount:metrics.ordersCount,daysSinceLastOrder:metrics.daysSinceLastOrder,openComplaints:openCases,subscriptionProblem:(subscriptions||[]).some((x:any)=>x.status==="past_due"),loyaltyActive:Boolean(loyalty)}),stage=lifecycleFor({ordersCount:metrics.ordersCount,daysSinceLastOrder:metrics.daysSinceLastOrder,loyaltyActive:Boolean(loyalty)}),valueBand=metrics.ordersCount===0?"new":metrics.daysSinceLastOrder!==null&&metrics.daysSinceLastOrder>=60?"dormant":metrics.lifetimeRevenueCents>=100000?"high_value":metrics.ordersCount>=4?"regular":"occasional";
        await admin.from("customer_360_summaries").upsert({organization_id:job.organization_id,customer_id:job.customer_id,preferred_store_id:customer.establishment_id,first_order_at:metrics.firstOrderAt,last_order_at:metrics.lastOrderAt,orders_count:metrics.ordersCount,lifetime_revenue_cents:metrics.lifetimeRevenueCents,average_ticket_cents:metrics.averageTicketCents,loyalty_status:loyalty?"active":null,loyalty_points:loyalty?.balance||0,open_support_cases_count:openCases,active_subscription_count:(subscriptions||[]).filter((x:any)=>["active","trialing"].includes(x.status)).length,churn_risk_level:health.level,relationship_value_band:valueBand,lifecycle_stage:stage,data_as_of:now.toISOString(),source_freshness:{orders:now.toISOString()},updated_at:now.toISOString()},{onConflict:"organization_id,customer_id"});
        await admin.from("customer360_health_snapshots").insert({organization_id:job.organization_id,customer_id:job.customer_id,store_id:customer.establishment_id,health:health.level,reason_codes:health.reasons.map((_:string,i:number)=>`reason_${i+1}`),explanation:health.reasons,signals_safe:{orders_count:metrics.ordersCount,days_since_last_order:metrics.daysSinceLastOrder,open_cases:openCases},rule_version:health.ruleVersion,probabilistic:false,sensitive_signals_used:false});
        await admin.from("fact_customer_relationship").upsert({organization_id:job.organization_id,customer_id:job.customer_id,store_id:customer.establishment_id,snapshot_date:now.toISOString().slice(0,10),orders_count:metrics.ordersCount,revenue_cents:metrics.lifetimeRevenueCents,average_ticket_cents:metrics.averageTicketCents,recency_days:metrics.daysSinceLastOrder,value_band:valueBand,data_as_of:now.toISOString()},{onConflict:"organization_id,customer_id,snapshot_date"});
      }
      await admin.from("customer360_refresh_jobs").update({status:"completed",completed_at:new Date().toISOString()}).eq("id",job.id);completed++;
    }catch(cause:any){failed++;const attempts=job.attempts+1,status=attempts>=job.max_attempts?"dead_lettered":"pending";await admin.from("customer360_refresh_jobs").update({status,last_error:String(cause?.message||cause),available_at:new Date(Date.now()+Math.min(3600000,30000*2**attempts)).toISOString()}).eq("id",job.id)}
  }
  return NextResponse.json({processed:(jobs||[]).length,completed,failed,canonicalSourcesUnchanged:true});
}
