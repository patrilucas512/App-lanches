import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { IntegrationCenter } from "@/components/integration-center";
import { getDashboardContext } from "@/lib/dashboard";
export default async function IntegrationsPage(){
 const{supabase,establishment,member,organization,availableStores}=await getDashboardContext();if(!["owner","manager"].includes(member.role))redirect("/painel");const orgId=establishment.organization_id||establishment.id;const today=new Date();today.setHours(0,0,0,0);
 const[{data:integrations},{data:clients},{data:endpoints},{data:deliveries},{data:logs},{count:requestsToday}]=await Promise.all([
  supabase.from("integrations").select("*").eq("organization_id",orgId).order("updated_at",{ascending:false}),
  supabase.from("api_clients").select("id,name,client_id,secret_prefix,status,scopes,all_stores,environment,rate_limit_per_minute,expires_at,last_used_at,created_at").eq("organization_id",orgId).order("created_at",{ascending:false}),
  supabase.from("webhook_endpoints").select("id,name,url,status,subscribed_events,environment,last_delivery_at,last_success_at,last_error,created_at").eq("organization_id",orgId).order("created_at",{ascending:false}),
  supabase.from("webhook_deliveries").select("id,event_id,status,attempt_count,http_status,error_message,created_at,integration_events(event_type)").eq("organization_id",orgId).order("created_at",{ascending:false}).limit(100),
  supabase.from("integration_logs").select("id,event_type,level,message,created_at").eq("organization_id",orgId).order("created_at",{ascending:false}).limit(100),
  supabase.from("api_request_logs").select("id",{count:"exact",head:true}).eq("organization_id",orgId).gte("created_at",today.toISOString()),
 ]);
 const metrics={connected:(integrations||[]).filter((item:any)=>item.status==="active").length,errors:(integrations||[]).filter((item:any)=>item.status==="error").length,failing:(deliveries||[]).filter((item:any)=>item.status==="failed").length,requestsToday:requestsToday||0,lastSync:(integrations||[]).map((item:any)=>item.last_sync_at).filter(Boolean).sort().at(-1)||null};
 return <DashboardShell brand={establishment} active="integrations" storeSlug={establishment.slug} role={member.role}><header className="admin-page-heading"><div><small>CONFIGURAÇÕES · ECOSSISTEMA</small><h1>Central de Integrações</h1><p>API pública versionada, webhooks assinados, conectores, credenciais e observabilidade sem expor o banco.</p></div><span className="status-pill">API v1 ativa</span></header><IntegrationCenter organizationId={orgId} stores={(availableStores||[]).map((item:any)=>({id:item.id,name:item.name}))} integrations={(integrations||[])as never[]} clients={(clients||[])as never[]} endpoints={(endpoints||[])as never[]} deliveries={(deliveries||[])as never[]} logs={(logs||[])as never[]} metrics={metrics}/></DashboardShell>
}
