import { DashboardShell } from "@/components/dashboard-shell";
import { SaasSupportCenter } from "@/components/saas-support-center";
import { getDashboardContext } from "@/lib/dashboard";
import { createAdminClient } from "@/lib/supabase/admin";
export default async function SupportCenterPage(){
 const {supabase,userId,establishment,plan,member}=await getDashboardContext();const orgId=establishment.organization_id||establishment.id;const admin=createAdminClient();
 const ownerRoles=["owner","admin","supervisor"];let ticketsQuery=supabase.from("support_tickets").select("id,organization_id,subject,description,category,priority,status,updated_at,created_at,queue_id,saas_support_queues(name)").eq("organization_id",orgId).order("updated_at",{ascending:false});
 if(!ownerRoles.includes((await supabase.from("organization_members").select("role").eq("organization_id",orgId).eq("user_id",userId).maybeSingle()).data?.role||""))ticketsQuery=ticketsQuery.eq("created_by_user_id",userId);
 const [{data:tickets},{data:messages},{data:articles},{data:components},{data:incidents},{data:links},{data:diagnostics}]=await Promise.all([
  ticketsQuery,
  supabase.from("support_ticket_messages").select("id,ticket_id,sender_type,message,internal_note,created_at").order("created_at"),
  supabase.from("support_articles").select("id,title,slug,category,content").eq("status","published").in("audience",["customer","both"]).order("title"),
  admin.from("saas_support_components").select("id,name,status,public_message,checked_at").order("name"),
  admin.from("support_incidents").select("id,title,status,severity,affected_components,public_summary,started_at,resolved_at").eq("is_public",true).neq("status","resolved").order("started_at",{ascending:false}),
  admin.from("support_ticket_incidents").select("ticket_id,incident_id"),
  admin.from("support_diagnostic_snapshots").select("id,overall_status,customer_result,created_at").eq("organization_id",orgId).order("created_at",{ascending:false}).limit(1)
 ]);
 const safeTickets=(tickets||[]).map((t:any)=>({...t,support_ticket_incidents:(links||[]).filter((x:any)=>x.ticket_id===t.id)}));const ids=new Set(safeTickets.map((t:any)=>t.id));
 return <DashboardShell brand={establishment} active="saas-support" storeSlug={establishment.slug} role={member.role}><header className="dashboard-head"><div><small>SUPORTE DA PLATAFORMA</small><h1>Central de Suporte MasterApp</h1><p>Chamados, ajuda, diagnóstico e status do SaaS — separados do atendimento dos clientes do restaurante.</p></div></header><SaasSupportCenter organizationId={orgId} establishmentId={establishment.id} planName={(plan as any)?.name||"Plano atual"} tickets={safeTickets} messages={(messages||[]).filter((m:any)=>ids.has(m.ticket_id))} articles={articles||[]} components={components||[]} incidents={incidents||[]} diagnostic={diagnostics?.[0]||null}/></DashboardShell>
}
