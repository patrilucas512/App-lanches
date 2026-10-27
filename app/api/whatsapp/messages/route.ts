import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendStoredWhatsAppText } from "@/lib/whatsapp/message-service";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { conversation_id?: string; text?: string; client_request_id?: string };
    const text = String(body.text || "").trim().slice(0, 4096);
    const conversationId = String(body.conversation_id || "");
    const clientRequestId = String(body.client_request_id || "");
    if (!conversationId || !text || !/^[0-9a-f-]{36}$/i.test(clientRequestId)) return NextResponse.json({ error: "Mensagem inválida." }, { status: 400 });
    const supabase = await createClient();
    const { data: claims } = await (supabase.auth as unknown as { getClaims: () => Promise<{ data: { claims?: { sub?: string } } }> }).getClaims();
    const userId = claims?.claims?.sub;
    if (!userId) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
    const { data: conversation } = await supabase.from("whatsapp_conversations").select("id,establishment_id,contact_id,connection_id,assigned_user_id,whatsapp_contacts(wa_id)").eq("id", conversationId).maybeSingle();
    if (!conversation) return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });
    const [{ data: member }, { data: permission }] = await Promise.all([
      supabase.from("establishment_members").select("role").eq("establishment_id", conversation.establishment_id).eq("user_id", userId).maybeSingle(),
      supabase.from("whatsapp_member_permissions").select("can_respond").eq("establishment_id", conversation.establishment_id).eq("user_id", userId).maybeSingle(),
    ]);
    if (!member || (!(member.role === "owner" || member.role === "manager") && (!permission?.can_respond || conversation.assigned_user_id !== userId))) return NextResponse.json({ error: "Assuma o atendimento antes de responder." }, { status: 403 });
    const admin = createAdminClient();
    const { data: existing } = await admin.from("whatsapp_messages").select("id,status,whatsapp_message_id").eq("establishment_id", conversation.establishment_id).eq("client_request_id", clientRequestId).maybeSingle();
    if (existing) return NextResponse.json({ message: existing });
    const connectionQuery = admin.from("whatsapp_connections").select("id,status").eq("establishment_id", conversation.establishment_id).eq("status", "connected");
    const { data: connection } = conversation.connection_id ? await connectionQuery.eq("id",conversation.connection_id).maybeSingle() : await connectionQuery.eq("is_primary",true).maybeSingle();
    if (!connection) return NextResponse.json({ error: "WhatsApp não está conectado." }, { status: 409 });
    const contact = Array.isArray(conversation.whatsapp_contacts) ? conversation.whatsapp_contacts[0] : conversation.whatsapp_contacts;
    const waId = (contact as { wa_id?: string } | null)?.wa_id;
    if (!waId) return NextResponse.json({ error: "Contato inválido." }, { status: 400 });
    try {
      const message = await sendStoredWhatsAppText({ admin, establishmentId:conversation.establishment_id, connectionId:connection.id, conversationId:conversation.id, contactId:conversation.contact_id, waId, text, sentByUserId:userId, clientRequestId });
      await admin.rpc("record_support_human_response",{requested_conversation_id:conversation.id,requested_user_id:userId});
      await admin.from("audit_logs").insert({ establishment_id: conversation.establishment_id, actor_id: userId, action: "whatsapp.message_sent", entity_type: "whatsapp_message", entity_id: message?.id, metadata: { conversation_id: conversation.id } });
      return NextResponse.json({ message });
    } catch (error) {
      return NextResponse.json({ error: "Não foi possível enviar esta mensagem. Tente novamente." }, { status: 502 });
    }
  } catch {
    return NextResponse.json({ error: "Não foi possível enviar esta mensagem. Tente novamente." }, { status: 500 });
  }
}
