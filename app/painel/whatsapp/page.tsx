import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { WhatsAppInbox } from "@/components/whatsapp-inbox";
import { getDashboardContext } from "@/lib/dashboard";

export default async function WhatsAppPage({ searchParams }: { searchParams: Promise<{ conversa?:string; monitor?:string }> }) {
  const params = await searchParams;
  const { supabase, establishment, member, userId } = await getDashboardContext();
  const ownerAccess = member.role === "owner" || member.role === "manager";
  const [{ data: permission }, { data: connection }, { data: conversations }, { data: carts }, { data: metrics }] = await Promise.all([
    supabase.from("whatsapp_member_permissions").select("can_view,can_respond,can_claim,can_resolve,can_configure,can_monitor").eq("establishment_id", establishment.id).eq("user_id", userId).maybeSingle(),
    supabase.from("whatsapp_connections").select("id,status,webhook_status,display_phone_number,verified_name,ai_enabled,automatic_replies_enabled").eq("establishment_id", establishment.id).eq("is_primary",true).maybeSingle(),
    supabase.from("whatsapp_conversations").select("id,status,assigned_user_id,unread_count,last_message_preview,last_message_at,human_controlled,last_automation_intent,last_ai_response_at,whatsapp_contacts(id,wa_id,phone_number,name,profile_name)").eq("establishment_id", establishment.id).order("last_message_at", { ascending:false }).limit(100),
    supabase.from("whatsapp_carts").select("id,conversation_id,status,state,fulfillment_type,payment_method,subtotal_cents,discount_cents,delivery_fee_cents,total_cents,converted_order_id,expires_at,whatsapp_cart_items(id,product_name,variation_name,quantity,total_cents)").eq("establishment_id",establishment.id).in("status",["active","awaiting_information","awaiting_confirmation","converted"]).order("updated_at",{ascending:false}).limit(100),
    supabase.rpc("get_whatsapp_commerce_metrics",{requested_establishment_id:establishment.id}),
  ]);
  if (!ownerAccess && !permission?.can_view) redirect("/painel/garcom");
  if (params.monitor === "1" && !ownerAccess && !permission?.can_monitor) redirect("/painel/whatsapp");
  const requestedConversation = conversations?.find((item:{id:string}) => item.id === params.conversa);
  const firstConversationId = requestedConversation?.id || conversations?.[0]?.id;
  const { data: messages } = firstConversationId
    ? await supabase.from("whatsapp_messages").select("id,conversation_id,direction,message_type,content,status,sent_by_user_id,message_timestamp,created_at,error_message").eq("establishment_id", establishment.id).eq("conversation_id", firstConversationId).order("message_timestamp").limit(500)
    : { data: [] };
  const permissions = ownerAccess ? { can_view:true,can_respond:true,can_claim:true,can_resolve:true,can_configure:true } : permission;
  return <DashboardShell brand={establishment} active="whatsapp" storeSlug={establishment.slug} role={member.role}>
    <header className="dashboard-head whatsapp-page-head"><div><small>ATENDIMENTO HÍBRIDO</small><h1>WhatsApp.</h1><p>IA para respostas rápidas, com controle humano sempre disponível.</p></div><span className={`status-pill ${connection?.status === "connected" ? "active":""}`}>{connection?.status === "connected" ? "Conectado":"Desconectado"}</span></header>
    <section className="whatsapp-commerce-metrics" aria-label="Resultados comerciais do WhatsApp hoje">
      <article><small>CONVERSAS HOJE</small><b>{Number(metrics?.conversations_today||0)}</b></article><article><small>PEDIDOS HOJE</small><b>{Number(metrics?.orders_today||0)}</b></article><article><small>PAGOS ONLINE</small><b>{Number(metrics?.paid_orders_today||0)}</b></article><article><small>FATURAMENTO</small><b>{(Number(metrics?.revenue_today_cents||0)/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}</b></article><article><small>CARRINHOS RECUPERADOS</small><b>{Number(metrics?.recovered_carts_today||0)}</b></article>
    </section>
    <WhatsAppInbox establishmentId={establishment.id} currentUserId={userId} connection={(connection || null) as never} initialConversations={(conversations || []) as never[]} initialMessages={(messages || []) as never[]} initialCarts={(carts || []) as never[]} permissions={permissions as never} initialSelectedId={firstConversationId} monitorMode={params.monitor === "1" && Boolean(requestedConversation)} />
  </DashboardShell>;
}

