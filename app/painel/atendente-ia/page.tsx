import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { AIAttendantManager } from "@/components/ai-attendant-manager";
import { getDashboardContext } from "@/lib/dashboard";

export default async function AIAttendantPage(){
  const {supabase,establishment,member,userId,plan}=await getDashboardContext();
  const owner=["owner","manager"].includes(member.role);
  const {data:permission}=owner?{data:null}:await supabase.from("ai_member_permissions").select("*").eq("establishment_id",establishment.id).eq("user_id",userId).maybeSingle();
  if(!owner&&!permission?.can_view)redirect("/painel");
  const [{data:versions},{data:connection},{data:metrics},{data:suggestions},{data:analysis},{data:alerts},{data:entitlements},{data:members}]=await Promise.all([
    supabase.from("ai_config_versions").select("*").eq("establishment_id",establishment.id).order("version",{ascending:false}),
    supabase.from("whatsapp_connections").select("id,status,webhook_status,display_phone_number,verified_name,last_error,last_webhook_at,ai_enabled").eq("establishment_id",establishment.id).order("updated_at",{ascending:false}).limit(1).maybeSingle(),
    owner||permission?.can_view_metrics?supabase.rpc("get_ai_dashboard",{requested_establishment_id:establishment.id,requested_days:30}):Promise.resolve({data:{}}),
    supabase.from("ai_learning_suggestions").select("*").eq("establishment_id",establishment.id).order("occurrences",{ascending:false}).limit(100),
    owner||permission?.can_view_metrics?supabase.from("ai_conversation_analysis").select("*,whatsapp_conversations(last_message_preview,last_message_at,status,human_controlled)").eq("establishment_id",establishment.id).order("updated_at",{ascending:false}).limit(100):Promise.resolve({data:[]}),
    supabase.from("ai_alerts").select("*").eq("establishment_id",establishment.id).is("acknowledged_at",null).order("created_at",{ascending:false}).limit(20),
    plan?.id?supabase.from("ai_plan_entitlements").select("*").eq("plan_id",plan.id).maybeSingle():Promise.resolve({data:null}),
    owner?supabase.from("establishment_members").select("user_id,role,profiles(full_name,email),ai_member_permissions(*)").eq("establishment_id",establishment.id):Promise.resolve({data:[]}),
  ]);
  const editable=(versions||[]).find((item:Record<string,unknown>)=>item.status==="draft")||(versions||[]).find((item:Record<string,unknown>)=>item.status==="published");
  const configId=editable?.id;
  const [{data:knowledge},{data:faqs},{data:rules}]=configId?await Promise.all([
    supabase.from("ai_knowledge_items").select("*").eq("establishment_id",establishment.id).eq("config_version_id",configId).order("updated_at",{ascending:false}),
    supabase.from("ai_faqs").select("*").eq("establishment_id",establishment.id).eq("config_version_id",configId).order("updated_at",{ascending:false}),
    supabase.from("ai_custom_rules").select("*").eq("establishment_id",establishment.id).eq("config_version_id",configId).order("priority"),
  ]):[{data:[]},{data:[]},{data:[]}];
  const permissions=owner?{can_view:true,can_edit_personality:true,can_edit_knowledge:true,can_edit_rules:true,can_publish:true,can_view_metrics:true,can_view_costs:true,can_use_simulator:true}:{...permission};
  return <DashboardShell brand={establishment} active="ai-attendant" storeSlug={establishment.slug} role={member.role}>
    <header className="admin-page-heading"><div><small>WHATSAPP · AUTOMAÇÃO</small><h1>Atendente IA</h1><p>Personalize, teste e acompanhe a atendente da sua empresa sem alterar código.</p></div></header>
    <AIAttendantManager establishmentId={establishment.id} userId={userId} permissions={permissions} versions={(versions||[]) as never[]} connection={connection as never} metrics={(metrics||{}) as never} knowledge={(knowledge||[]) as never[]} faqs={(faqs||[]) as never[]} rules={(rules||[]) as never[]} suggestions={(suggestions||[]) as never[]} analysis={(analysis||[]) as never[]} alerts={(alerts||[]) as never[]} entitlements={entitlements as never} members={(members||[]) as never[]} />
  </DashboardShell>;
}
