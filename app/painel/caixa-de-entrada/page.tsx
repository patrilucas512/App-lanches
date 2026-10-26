import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { OmnichannelInbox } from "@/components/omnichannel-inbox";
import { getDashboardContext } from "@/lib/dashboard";

export default async function OmnichannelInboxPage(){
  const {supabase,establishment,member,userId}=await getDashboardContext();const owner=["owner","manager"].includes(member.role);
  const {data:permission}=owner?{data:null}:await supabase.from("omnichannel_member_permissions").select("can_view,can_view_analytics").eq("establishment_id",establishment.id).eq("user_id",userId).maybeSingle();
  if(!owner&&!permission?.can_view)redirect("/painel");
  const [{data:conversations},{data:analytics},{data:queues}]=await Promise.all([supabase.rpc("list_omnichannel_inbox",{requested_establishment_id:establishment.id,requested_limit:200}),owner||permission?.can_view_analytics?supabase.rpc("get_omnichannel_analytics",{requested_establishment_id:establishment.id,requested_days:30}):Promise.resolve({data:{channels:[],orders:[],journeys:[]}}),supabase.from("support_queues").select("id,name").or(`store_id.eq.${establishment.id},and(store_id.is.null,organization_id.eq.${establishment.organization_id})`).eq("status","active").order("priority")]);
  return <DashboardShell brand={establishment} active="inbox" storeSlug={establishment.slug} role={member.role}><header className="admin-page-heading"><div><small>ATENDIMENTO · TODOS OS CANAIS</small><h1>Caixa de Entrada</h1><p>WhatsApp, telefone e chat do site em uma única visão, com IA, equipe, pedidos e histórico do cliente.</p></div><span className="status-pill active">Omnichannel</span></header><OmnichannelInbox establishmentId={establishment.id} currentUserId={userId} initialConversations={(conversations||[]) as never[]} initialAnalytics={(analytics||{channels:[],orders:[],journeys:[]}) as never} queues={(queues||[]) as never[]}/></DashboardShell>
}

