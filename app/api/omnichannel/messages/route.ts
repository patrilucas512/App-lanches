import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendStoredWhatsAppText } from "@/lib/whatsapp/message-service";
import { persistNormalized } from "@/lib/omnichannel/adapters";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { conversation_id?: string; text?: string; client_request_id?: string };
    const conversationId = String(body.conversation_id || ""); const text = String(body.text || "").trim().slice(0, 4096); const clientId = String(body.client_request_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(conversationId) || !/^[0-9a-f-]{36}$/i.test(clientId) || !text) return NextResponse.json({ error: "Mensagem inválida." }, { status: 400 });
    const supabase = await createClient();
    const { data: claims } = await (supabase.auth as unknown as { getClaims: () => Promise<{ data: { claims?: { sub?: string } } }> }).getClaims();
    const userId = claims?.claims?.sub; if (!userId) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
    const { data: canonical } = await supabase.from("omnichannel_conversations").select("*").eq("id", conversationId).maybeSingle();
    if (!canonical) return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });
    const { data: member } = await supabase.from("establishment_members").select("role").eq("establishment_id", canonical.establishment_id).eq("user_id", userId).eq("status", "active").maybeSingle();
    const { data: permission } = await supabase.from("omnichannel_member_permissions").select("can_reply_web_chat,can_reply_whatsapp").eq("establishment_id", canonical.establishment_id).eq("user_id", userId).maybeSingle();
    const manager = member && ["owner", "manager"].includes(member.role);
    if (!manager && !(canonical.current_channel === "web_chat" ? permission?.can_reply_web_chat : permission?.can_reply_whatsapp)) return NextResponse.json({ error: "Sem permissão para responder neste canal." }, { status: 403 });
    const admin = createAdminClient();
    if (canonical.current_channel === "web_chat") {
      const { data, error } = await supabase.rpc("send_web_chat_staff_message", { requested_conversation_id: conversationId, requested_text: text, requested_client_id: clientId });
      return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ message_id: data, status: "sent" });
    }
    if (canonical.current_channel !== "whatsapp" || !canonical.whatsapp_conversation_id) return NextResponse.json({ error: "A ligação ativa não aceita resposta de texto." }, { status: 409 });
    const { data: legacy } = await admin.from("whatsapp_conversations").select("id,contact_id,connection_id,whatsapp_contacts(wa_id)").eq("id", canonical.whatsapp_conversation_id).single();
    const contact = Array.isArray(legacy.whatsapp_contacts) ? legacy.whatsapp_contacts[0] : legacy.whatsapp_contacts;
    const sent = await sendStoredWhatsAppText({ admin, establishmentId: canonical.establishment_id, connectionId: legacy.connection_id, conversationId: legacy.id, contactId: legacy.contact_id, waId: String((contact as { wa_id?: string })?.wa_id || ""), text, sentByUserId: userId, clientRequestId: clientId });
    const { data: thread } = await admin.from("channel_threads").select("id,channel_id").eq("conversation_id", conversationId).eq("external_thread_id", legacy.id).single();
    await persistNormalized(admin, { channel: "whatsapp", channelMessageId: String(sent?.whatsapp_message_id || sent?.id || clientId), organizationId: canonical.organization_id, establishmentId: canonical.establishment_id, customerId: canonical.customer_id, conversationId, channelThreadId: thread.id, channelId: thread.channel_id, direction: "outbound", type: "text", text, media: [], status: (sent?.status || "sent") as "sent", timestamp: new Date().toISOString(), metadata: { legacy_message_id: sent?.id, actor_user_id: userId } });
    return NextResponse.json({ message_id: sent?.id, status: sent?.status || "sent" });
  } catch { return NextResponse.json({ error: "Não foi possível enviar a mensagem." }, { status: 500 }); }
}
