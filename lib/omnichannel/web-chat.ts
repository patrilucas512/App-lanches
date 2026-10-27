import type { SupabaseClient } from "@supabase/supabase-js";
import { processConversationalOrder } from "@/lib/ai-attendant/order-conversation";
import { executeMasterAppTool } from "@/lib/ai-attendant/masterapp-tools";
import { routeByRules } from "@/lib/ai-attendant/intent-router";
import { WebChatAdapter } from "./adapters";

export async function processWebChatAutomation(admin: SupabaseClient, input: { sessionId: string; inboundMessageId: string; text: string }) {
  const { data: session, error } = await admin.from("web_chat_sessions").select("id,organization_id,establishment_id,customer_id,conversation_id,channel_thread_id,status,channels:channel_threads(channel_id),omnichannel_conversations(human_controlled)").eq("id", input.sessionId).maybeSingle();
  if (error || !session || session.status !== "active") return;
  const conversation = Array.isArray(session.omnichannel_conversations) ? session.omnichannel_conversations[0] : session.omnichannel_conversations;
  if ((conversation as { human_controlled?: boolean } | null)?.human_controlled) return;
  const thread = Array.isArray(session.channels) ? session.channels[0] : session.channels;
  const context = { admin, organizationId: String(session.organization_id), establishmentId: String(session.establishment_id), conversationId: String(session.conversation_id), channelId: String((thread as { channel_id?: string } | null)?.channel_id || ""), channelThreadId: String(session.channel_thread_id), customerId: session.customer_id as string | null };
  if (!context.channelId) return;
  const adapter = new WebChatAdapter(context);
  const normalized = input.text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/\b(continuar|seguir|mudar)\b.*\bwhatsapp\b/.test(normalized)) {
    if (!session.customer_id) { await adapter.send({ conversationId: session.conversation_id, text: "Para continuar com segurança no WhatsApp, envie primeiro seu número com DDD.", clientRequestId: `continuity-phone:${input.inboundMessageId}` }); return; }
    const { data: continuity, error: continuityError } = await admin.rpc("create_channel_continuity", { requested_conversation_id: session.conversation_id, requested_to_channel: "whatsapp", requested_consent: true });
    if (continuityError) { await adapter.send({ conversationId: session.conversation_id, text: "Não consegui preparar a continuidade agora. Seu carrinho continua salvo aqui.", clientRequestId: `continuity-error:${input.inboundMessageId}` }); return; }
    const { data: customerPhone } = await admin.from("customers").select("phone").eq("id", session.customer_id).maybeSingle();
    const digits = String(customerPhone?.phone || "").replace(/\D/g, "");
    await adapter.send({ conversationId: session.conversation_id, text: `Continuidade autorizada. Abra o WhatsApp e envie “CONTINUAR ${continuity.token}”${digits ? ` usando o número ${digits}` : ""}. Seu carrinho não será duplicado.`, clientRequestId: `continuity:${input.inboundMessageId}` });
    return;
  }
  if (/\b(atendente|humano|pessoa|equipe)\b/.test(normalized)) {
    await admin.from("omnichannel_conversations").update({ human_controlled: true, operational_status: "queued", status: "waiting", queued_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", session.conversation_id).eq("establishment_id", session.establishment_id);
    await adapter.send({ conversationId: session.conversation_id, text: "Certo. Transferi esta conversa para a equipe. Seu histórico e carrinho foram preservados.", clientRequestId: `handoff:${input.inboundMessageId}` });
    return;
  }
  const phone = input.text.replace(/\D/g, "").match(/(?:55)?\d{10,11}/)?.[0];
  if (phone && !session.customer_id) {
    const normalizedPhone = phone.startsWith("55") ? phone : `55${phone}`;
    const { data: existing } = await admin.from("customers").select("id,name,phone").eq("establishment_id", session.establishment_id).eq("normalized_phone", normalizedPhone).maybeSingle();
    if (existing) {
      await admin.from("identity_match_suggestions").upsert({ organization_id: session.organization_id, establishment_id: session.establishment_id, candidate_customer_id: existing.id, identity_type: "phone", value_normalized: normalizedPhone, confidence: 0.75, reason: "Telefone informado em sessão web ainda não verificada" }, { onConflict: "organization_id,identity_type,value_normalized,candidate_customer_id" });
      await adapter.send({ conversationId: session.conversation_id, text: `Encontrei um cadastro que pode ser seu. Para sua segurança, a equipe confirmará a associação. Você pode continuar o atendimento normalmente.`, clientRequestId: `match:${input.inboundMessageId}` });
    } else {
      const { data: customer } = await admin.from("customers").insert({ establishment_id: session.establishment_id, name: "Cliente do site", phone: normalizedPhone }).select("id").single();
      if (customer) {
        await admin.from("customer_identities").insert({ customer_id: customer.id, organization_id: session.organization_id, establishment_id: session.establishment_id, identity_type: "phone", value_normalized: normalizedPhone, verified: false, verification_source: "web_chat_self_reported" });
        await admin.from("web_chat_sessions").update({ customer_id: customer.id }).eq("id", session.id);
        await admin.from("omnichannel_conversations").update({ customer_id: customer.id }).eq("id", session.conversation_id);
        await admin.from("whatsapp_carts").update({ customer_id: customer.id, customer_phone: normalizedPhone }).eq("web_chat_session_id", session.id).in("status", ["active", "awaiting_information", "awaiting_confirmation"]);
        context.customerId = customer.id;
      }
      await adapter.send({ conversationId: session.conversation_id, text: "Contato salvo nesta conversa. Quando quiser avançar com o pedido, escreva “finalizar”.", clientRequestId: `identity:${input.inboundMessageId}` });
    }
    return;
  }
  if (/\b(finalizar|fechar|concluir)\b/.test(normalized) && !session.customer_id) {
    await adapter.send({ conversationId: session.conversation_id, text: "Antes de finalizar, envie seu número com DDD. Ele será usado somente para identificar o pedido e não será unido a outro cadastro sem confirmação segura.", clientRequestId: `phone:${input.inboundMessageId}` });
    return;
  }
  const { data: customer } = session.customer_id ? await admin.from("customers").select("name,phone").eq("id", session.customer_id).maybeSingle() : { data: null };
  const order = await processConversationalOrder({ admin: admin as never, establishmentId: session.establishment_id, channel: "web_chat", webChatSessionId: session.id, conversationId: session.conversation_id, customerId: session.customer_id, customerPhone: customer?.phone || "", customerName: customer?.name || "Visitante do site", messageId: input.inboundMessageId, text: input.text });
  if (order.handled && order.answer) {
    await adapter.send({ conversationId: session.conversation_id, text: order.answer, clientRequestId: `ai:${input.inboundMessageId}` });
    return;
  }
  const decision = routeByRules(input.text);
  if (decision) {
    const result = await executeMasterAppTool(decision.intent, { admin: admin as never, establishmentId: session.establishment_id, waId: customer?.phone || "", query: decision.query, attendantName: "Atendente virtual", humanHandoffEnabled: true });
    await adapter.send({ conversationId: session.conversation_id, text: result.answer, clientRequestId: `ai:${input.inboundMessageId}` });
    return;
  }
  await adapter.send({ conversationId: session.conversation_id, text: "Posso ajudar com o cardápio, montar um pedido, consultar um pedido ou chamar uma pessoa da equipe. O que você deseja?", clientRequestId: `ai:${input.inboundMessageId}` });
}

