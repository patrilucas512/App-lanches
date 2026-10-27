import { DashboardShell } from "@/components/dashboard-shell";
import { SettingsForm } from "@/components/settings-form";
import { PixSettingsForm } from "@/components/pix-settings-form";
import { MultiPrinterManager } from "@/components/multi-printer-manager";
import { KitchenAccessManager } from "@/components/kitchen-access";
import { BusinessHoursForm } from "@/components/business-hours-form";
import { DeliverySettingsManager } from "@/components/delivery-settings-manager";
import { PaymentGatewayManager } from "@/components/payment-gateway-manager";
import { WhatsAppSettingsManager } from "@/components/whatsapp-settings-manager";
import { VoiceSettingsManager } from "@/components/voice-settings-manager";
import { WebChatWidgetManager } from "@/components/web-chat-widget-manager";
import { CustomerPortalSettings } from "@/components/customer-portal-settings";
import { getDashboardContext } from "@/lib/dashboard";
import { redirect } from "next/navigation";

export default async function SettingsPage() {
  const { supabase, establishment, member, userId } = await getDashboardContext();
  if (!["owner", "manager"].includes(member.role)) redirect("/painel/garcom");
  const [{ data: details }, { data: settings }, { data: pix }, { data: kitchenOperators }, { data: printers }, { data: registers }, { data: businessHours }, { data: deliverySettings }, { data: deliveryZones }, { data: paymentGateways }, { data: whatsappConnections }, { data: members }, { data: whatsappPermissions }, {data:voiceConnection},{data:webChatConfig},{data:customerPortalConfig}] = await Promise.all([
    supabase.from("establishments").select("*").eq("id", establishment.id).single(),
    supabase.from("establishment_settings").select("*").eq("establishment_id", establishment.id).single(),
    supabase.from("pix_settings").select("*").eq("establishment_id", establishment.id).maybeSingle(),
    supabase.from("kitchen_operators").select("id,user_id,name,phone,status,access_type,work_date,device_mode,permissions,payment_cycle").eq("establishment_id", establishment.id).order("created_at"),
    supabase.rpc("list_printer_devices", { requested_establishment_id: establishment.id }),
    supabase.from("cash_registers").select("id,name,active").eq("establishment_id",establishment.id).eq("active",true).order("created_at"),
    supabase.from("business_hours").select("weekday,opens_at,closes_at,closed").eq("establishment_id", establishment.id).order("weekday"),
    supabase.from("delivery_settings").select("service_city,service_state,id,establishment_id,fee_model,fixed_fee_cents,free_delivery_above_cents,alert_kitchen_delay_minutes,alert_waiting_driver_minutes,alert_driver_stale_minutes,alert_route_delay_minutes,alert_driver_stopped_minutes").eq("establishment_id", establishment.id).maybeSingle(),
    supabase.from("delivery_zones").select("id,name,fee_cents,minimum_order_cents,free_delivery_above_cents,estimated_minutes,distance_km,active").eq("establishment_id", establishment.id).order("name"),
    supabase.from("payment_gateway_accounts").select("id,provider,active,environment,merchant_account_id,configured_at").eq("establishment_id", establishment.id).order("provider"),
    supabase.from("whatsapp_connections").select("id,status,webhook_status,phone_number_id,whatsapp_business_account_id,display_phone_number,verified_name,graph_api_version,connected_at,last_webhook_at,last_error,ai_enabled,automatic_replies_enabled,human_handoff_enabled,ai_outside_business_hours,ai_attendant_name,ai_welcome_message,ai_fallback_message,cart_recovery_enabled,cart_recovery_delay_minutes,upsell_enabled,pix_expiration_minutes,notify_payment_confirmed,notify_order_preparing,notify_order_ready,notify_order_out_for_delivery,notify_order_delivered,label,is_primary,routing_mode").eq("establishment_id", establishment.id).order("is_primary",{ascending:false}).order("created_at"),
    supabase.from("establishment_members").select("user_id,role").eq("establishment_id", establishment.id).order("created_at"),
    supabase.from("whatsapp_member_permissions").select("user_id,can_view,can_respond,can_claim,can_resolve,can_configure,can_view_queue,can_transfer,can_change_priority,can_view_supervision,can_monitor,can_take_over,can_configure_sla,can_configure_queues,can_view_productivity,can_review_quality").eq("establishment_id", establishment.id),
    supabase.from("voice_connections").select("*").eq("establishment_id",establishment.id).maybeSingle(),
    supabase.from("web_chat_widget_configs").select("*").eq("establishment_id",establishment.id).maybeSingle(),
    supabase.from("customer_portal_configs").select("*").eq("establishment_id",establishment.id).maybeSingle(),
  ]);
  const permissionByUser = new Map(((whatsappPermissions || []) as Array<{ user_id:string; can_view:boolean; can_respond:boolean; can_claim:boolean; can_resolve:boolean; can_configure:boolean }>).map((item) => [item.user_id, item]));
  const whatsappTeam = ((members || []) as Array<{ user_id:string; role:string }>).map((item) => ({ user_id:item.user_id, role:item.role, label:item.user_id === userId ? "Você" : `Funcionário ${item.user_id.slice(0,8)}`, permissions:permissionByUser.get(item.user_id) || {} }));
  return <DashboardShell brand={establishment} active="settings" storeSlug={establishment.slug} role={member.role}>
    <header className="dashboard-head"><div><small>CONFIGURAÇÕES</small><h1>Identidade e atendimento.</h1></div></header>
    <SettingsForm establishmentId={establishment.id} initial={{
      name: details?.name ?? establishment.name, description: details?.description ?? "",
      phone: details?.phone ?? "", whatsapp: settings?.whatsapp ?? "",
      address: String(settings?.address?.street ?? ""), city: details?.city ?? "",
      state: details?.state ?? "", accentColor: details?.accent_color ?? "#6d2627",
      secondaryColor: details?.secondary_color ?? "#f5efe5",
      estimatedMinutes: settings?.estimated_minutes ?? 45,
      logoUrl: details?.logo_url ?? "",
    }} />
    <BusinessHoursForm establishmentId={establishment.id} initial={businessHours || []} />
    <DeliverySettingsManager establishmentId={establishment.id} initialSettings={(deliverySettings || { establishment_id: establishment.id, fee_model: "fixed", fixed_fee_cents: 0, free_delivery_above_cents: null, alert_kitchen_delay_minutes: 10, alert_waiting_driver_minutes: 10, alert_driver_stale_minutes: 8, alert_route_delay_minutes: 5 }) as never} initialZones={(deliveryZones || []) as never[]} />
    <PaymentGatewayManager establishmentId={establishment.id} initialAccounts={(paymentGateways || []) as never[]} />
    <WhatsAppSettingsManager establishmentId={establishment.id} initialConnection={(whatsappConnections?.[0] || null) as never} initialConnections={(whatsappConnections || []) as never[]} team={whatsappTeam as never[]} />
    <VoiceSettingsManager establishmentId={establishment.id} initial={(voiceConnection||null) as never}/>
    <WebChatWidgetManager establishmentId={establishment.id} organizationId={establishment.organization_id} initial={(webChatConfig||null) as never}/>
    <CustomerPortalSettings establishmentId={establishment.id} organizationId={establishment.organization_id} slug={establishment.slug} initial={(customerPortalConfig||null) as never}/>
    <KitchenAccessManager establishmentId={establishment.id} initialOperators={(kitchenOperators || []) as never[]} />
    <MultiPrinterManager establishmentId={establishment.id} establishmentName={details?.name ?? establishment.name} initialDevices={(printers || []) as never[]} initialRegisters={(registers || []) as never[]} />
    <PixSettingsForm establishmentId={establishment.id} initial={pix} />
  </DashboardShell>;
}
