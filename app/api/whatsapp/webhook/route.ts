import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyMetaSignature } from "@/lib/whatsapp/cloud-api";
import { processWhatsAppAutomation } from "@/lib/ai-attendant/orchestrator";
import { completeContinuityFromWhatsApp, recordWhatsAppInbound } from "@/lib/omnichannel/engine";
import type { MetaWebhookPayload, WhatsAppConnectionSecret } from "@/lib/whatsapp/types";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const connectionId = url.searchParams.get("connection");
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (!connectionId || mode !== "subscribe" || !token || !challenge) return new NextResponse("Verificação inválida.", { status: 400 });
  const admin = createAdminClient();
  const { data: secrets, error } = await admin.rpc("get_whatsapp_connection_secret", { requested_connection_id: connectionId });
  const secure = secrets as WhatsAppConnectionSecret | null;
  if (error || !secure?.verify_token || token !== secure.verify_token) return new NextResponse("Não autorizado.", { status: 403 });
  await admin.from("whatsapp_connections").update({ webhook_status: "verified", last_error: null }).eq("id", connectionId);
  return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  let payload: MetaWebhookPayload;
  try { payload = JSON.parse(rawBody) as MetaWebhookPayload; }
  catch { return NextResponse.json({ error: "Payload inválido." }, { status: 400 }); }
  if (payload.object !== "whatsapp_business_account") return NextResponse.json({ received: true });
  const changes = payload.entry?.flatMap((entry) => entry.changes || []) || [];
  const phoneNumberId = changes.find((change) => change.value?.metadata?.phone_number_id)?.value?.metadata?.phone_number_id;
  if (!phoneNumberId) return NextResponse.json({ received: true });

  const admin = createAdminClient();
  const { data: connection } = await admin.from("whatsapp_connections").select("id,status,establishment_id").eq("phone_number_id", phoneNumberId).eq("status", "connected").maybeSingle();
  if (!connection) return NextResponse.json({ error: "Conexão não encontrada." }, { status: 404 });
  const { data: secrets } = await admin.rpc("get_whatsapp_connection_secret", { requested_connection_id: connection.id });
  const secure = secrets as WhatsAppConnectionSecret | null;
  if (!secure?.app_secret || !verifyMetaSignature(rawBody, request.headers.get("x-hub-signature-256"), secure.app_secret))
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });

  try {
    for (const change of changes) {
      const value = change.value;
      if (!value || value.metadata?.phone_number_id !== phoneNumberId) continue;
      for (const message of value.messages || []) {
        if (!message.id || !message.from) continue;
        const contact = value.contacts?.find((item) => item.wa_id === message.from);
        const content = message.type === "text" ? String(message.text?.body || "").slice(0, 4096) : `[${message.type || "mensagem"}]`;
        const { data: storedMessageId } = await admin.rpc("process_whatsapp_inbound_message", {
          requested_connection_id: connection.id, requested_message_id: message.id, requested_wa_id: message.from,
          requested_profile_name: String(contact?.profile?.name || "").slice(0, 160), requested_content: content,
          requested_message_type: String(message.type || "unknown").slice(0, 40),
          requested_timestamp: new Date(Number(message.timestamp || 0) * 1000 || Date.now()).toISOString(),
        });
        if (storedMessageId) {
          const { data: stored } = await admin.from("whatsapp_messages").select("conversation_id,whatsapp_contacts(customer_id)").eq("id", String(storedMessageId)).maybeSingle();
          const linkedContact = Array.isArray(stored?.whatsapp_contacts) ? stored?.whatsapp_contacts[0] : stored?.whatsapp_contacts;
          if (stored?.conversation_id) {
            try { await recordWhatsAppInbound(admin, { establishmentId: connection.establishment_id, conversationId: String(stored.conversation_id), messageId: message.id, text: content, customerId: (linkedContact as { customer_id?: string | null } | null)?.customer_id || null, metadata: { provider: "meta", message_type: message.type || "unknown" } }); await completeContinuityFromWhatsApp(admin,{establishmentId:connection.establishment_id,legacyConversationId:String(stored.conversation_id),text:content}); }
            catch { /* Legacy WhatsApp remains authoritative if omnichannel projection is temporarily unavailable. */ }
          }
          try { await processWhatsAppAutomation({ connectionId: connection.id, messageId: String(storedMessageId) }); }
          catch { /* The webhook stays idempotent; automation failures are isolated from Meta retries. */ }
        }
      }
      for (const status of value.statuses || []) {
        if (!status.id || !["sent", "delivered", "read", "failed"].includes(String(status.status))) continue;
        const failure = status.errors?.[0];
        await admin.rpc("update_whatsapp_message_status", {
          requested_connection_id: connection.id, requested_message_id: status.id, requested_status: status.status,
          requested_error_code: failure?.code ? String(failure.code) : null,
          requested_error_message: String(failure?.message || failure?.title || failure?.error_data?.details || "").slice(0, 500) || null,
        });
        const recipientPatch = status.status === "delivered" ? { status: "delivered", delivered_at: new Date().toISOString(), updated_at: new Date().toISOString() }
          : status.status === "read" ? { status: "read", read_at: new Date().toISOString(), updated_at: new Date().toISOString() }
            : status.status === "failed" ? { status: "failed", error_message: String(failure?.message || failure?.title || "Falha informada pela Meta").slice(0, 500), updated_at: new Date().toISOString() }
              : { status: "sent", updated_at: new Date().toISOString() };
        await admin.from("crm_campaign_recipients").update(recipientPatch).eq("whatsapp_message_id", status.id).eq("establishment_id", connection.establishment_id);
      }
    }
    return NextResponse.json({ received: true });
  } catch {
    await admin.from("whatsapp_connections").update({ webhook_status: "error", last_error: "Falha ao processar o último evento recebido." }).eq("id", connection.id);
    return NextResponse.json({ error: "Falha temporária no processamento." }, { status: 500 });
  }
}

