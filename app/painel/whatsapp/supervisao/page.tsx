import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { SupportSupervision } from "@/components/support-supervision";
import { getDashboardContext } from "@/lib/dashboard";

export default async function SupportSupervisionPage() {
  const { supabase, establishment, member, userId } = await getDashboardContext();
  const owner = member.role === "owner" || member.role === "manager";
  const { data: permission } = await supabase.from("whatsapp_member_permissions").select("can_view_supervision,can_view_productivity,can_configure_queues,can_configure_sla,can_change_priority,can_transfer,can_take_over,can_review_quality,can_monitor,can_resolve").eq("establishment_id",establishment.id).eq("user_id",userId).maybeSingle();
  if (!owner && !permission?.can_view_supervision) redirect("/painel/whatsapp");
  const [{data:dashboard},{data:productivity},{data:peakHours},{data:queues},{data:presence},{data:settings},{data:members},{data:profiles}] = await Promise.all([
    supabase.rpc("get_support_supervision_dashboard",{requested_establishment_id:establishment.id,requested_period_days:1}),
    owner||permission?.can_view_productivity ? supabase.rpc("get_support_productivity",{requested_establishment_id:establishment.id,requested_days:7}) : Promise.resolve({data:[]}),
    owner||permission?.can_view_productivity ? supabase.rpc("get_support_peak_hours",{requested_establishment_id:establishment.id,requested_days:7}) : Promise.resolve({data:[]}),
    supabase.from("support_queues").select("id,name,status,assignment_strategy,sla_first_response_minutes,sla_resolution_minutes,auto_assignment_enabled,require_acceptance,acceptance_timeout_seconds,centralized").or(`store_id.eq.${establishment.id},and(store_id.is.null,organization_id.eq.${establishment.organization_id})`).order("priority"),
    supabase.from("support_agent_presence").select("user_id,status,pause_reason,last_seen_at,shift_starts_at,shift_ends_at").eq("organization_id",establishment.organization_id),
    supabase.from("support_settings").select("*").eq("establishment_id",establishment.id).maybeSingle(),
    supabase.from("establishment_members").select("user_id,role,status").eq("establishment_id",establishment.id).eq("status","active"),
    Promise.resolve({data:[]}),
  ]);
  const userIds=(members||[]).map((item:{user_id:string})=>item.user_id);
  const profileRows=userIds.length?(await supabase.from("profiles").select("id,full_name").in("id",userIds)).data||[]:profiles||[];
  const names=new Map((profileRows as {id:string;full_name:string|null}[]).map(item=>[item.id,item.full_name||"Funcionário"]));
  const team=(members||[]).map((item:{user_id:string;role:string})=>({...item,name:names.get(item.user_id)||"Funcionário"}));
  const permissions={supervision:true,productivity:owner||Boolean(permission?.can_view_productivity),configureQueues:owner||Boolean(permission?.can_configure_queues),configureSla:owner||Boolean(permission?.can_configure_sla),priority:owner||Boolean(permission?.can_change_priority),transfer:owner||Boolean(permission?.can_transfer),takeOver:owner||Boolean(permission?.can_take_over),quality:owner||Boolean(permission?.can_review_quality),monitor:owner||Boolean(permission?.can_monitor),resolve:owner||Boolean(permission?.can_resolve)};
  return <DashboardShell brand={establishment} active="whatsapp-supervision" storeSlug={establishment.slug} role={member.role}>
    <header className="admin-page-heading"><div><small>WHATSAPP · OPERAÇÃO EM TEMPO REAL</small><h1>Supervisão.</h1><p>Filas, equipe, SLA, produtividade e qualidade em uma única central.</p></div></header>
    <SupportSupervision establishmentId={establishment.id} organizationId={establishment.organization_id} currentUserId={userId} initialDashboard={(dashboard||{}) as never} initialProductivity={(productivity||[]) as never[]} initialPeakHours={(peakHours||[]) as never[]} initialQueues={(queues||[]) as never[]} initialPresence={(presence||[]) as never[]} settings={(settings||{}) as never} team={team as never[]} permissions={permissions} />
  </DashboardShell>;
}
