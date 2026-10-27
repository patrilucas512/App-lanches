import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { CrmManager } from "@/components/crm-manager";
import { getDashboardContext } from "@/lib/dashboard";

export default async function CrmPage() {
  const {supabase,establishment,member,userId}=await getDashboardContext();
  const owner=["owner","manager"].includes(member.role);
  const {data:permission}=owner?{data:null}:await supabase.from("crm_member_permissions").select("*").eq("establishment_id",establishment.id).eq("user_id",userId).maybeSingle();
  if(!owner&&!permission?.can_view) redirect("/painel");
  const [{data:metrics},{data:customers},{data:segments},{data:templates},{data:campaigns},{data:automations},{data:loyalty},{data:rules},{data:products},{data:coupons},{data:feedback}]=await Promise.all([
    supabase.rpc("get_crm_dashboard",{requested_establishment_id:establishment.id}),
    supabase.rpc("list_crm_customers",{requested_establishment_id:establishment.id,requested_limit:250}),
    supabase.from("crm_segments").select("*").eq("establishment_id",establishment.id).order("name"),
    supabase.from("whatsapp_message_templates").select("*").eq("establishment_id",establishment.id).order("name"),
    supabase.from("crm_campaigns").select("*,crm_segments(name),whatsapp_message_templates(name,status),coupons(code)").eq("establishment_id",establishment.id).order("created_at",{ascending:false}),
    supabase.from("crm_automations").select("*").eq("establishment_id",establishment.id).order("automation_type"),
    supabase.from("loyalty_programs").select("*").eq("establishment_id",establishment.id).maybeSingle(),
    supabase.from("crm_rules").select("*").eq("establishment_id",establishment.id).maybeSingle(),
    supabase.from("products").select("id,name,active").eq("establishment_id",establishment.id).eq("active",true).order("name"),
    supabase.from("coupons").select("id,code,active,starts_at,ends_at").eq("establishment_id",establishment.id).eq("active",true).order("code"),
    supabase.from("crm_feedback").select("id,rating,needs_human_attention,answered_at,customers(name),orders(order_number)").eq("establishment_id",establishment.id).order("created_at",{ascending:false}).limit(20),
  ]);
  const permissions=owner?{can_view:true,can_edit_customer:true,can_manage_segments:true,can_create_campaign:true,can_approve_campaign:true,can_cancel_campaign:true,can_view_metrics:true,can_configure_loyalty:true}:permission;
  return <DashboardShell brand={establishment} active="crm" storeSlug={establishment.slug} role={member.role}>
    <header className="dashboard-head crm-page-head"><div><small>RELACIONAMENTO COM DADOS REAIS</small><h1>CRM e fidelização.</h1><p>Clientes, segmentos e campanhas oficiais do WhatsApp, com consentimento e rastreabilidade.</p></div><span className="status-pill active">Fase 5</span></header>
    <CrmManager establishmentId={establishment.id} storeName={establishment.name} userId={userId} metrics={metrics||{}} customers={(customers||[]) as never[]} segments={(segments||[]) as never[]} templates={(templates||[]) as never[]} campaigns={(campaigns||[]) as never[]} automations={(automations||[]) as never[]} loyalty={loyalty as never} rules={rules as never} products={(products||[]) as never[]} coupons={(coupons||[]) as never[]} feedback={(feedback||[]) as never[]} permissions={permissions as never}/>
  </DashboardShell>;
}
