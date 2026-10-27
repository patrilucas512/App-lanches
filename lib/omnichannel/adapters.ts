import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelAdapter, ChannelSendInput, ChannelSendResult, ChannelType, NormalizedMessage } from "./types";

type AdapterContext = { admin: SupabaseClient; organizationId: string; establishmentId: string; conversationId: string; channelId: string; channelThreadId: string; customerId?: string | null };

abstract class BaseAdapter implements ChannelAdapter<Record<string, unknown>> {
  abstract readonly channel: ChannelType;
  constructor(protected readonly context: AdapterContext) {}
  async receive(payload: Record<string, unknown>) { const messages = await this.normalizeInbound(payload); for (const message of messages) await persistNormalized(this.context.admin, message); return messages; }
  abstract send(payload: ChannelSendInput): Promise<ChannelSendResult>;
  async markRead(conversationId: string) { await this.context.admin.from("omnichannel_conversations").update({ unread_count: 0, updated_at: new Date().toISOString() }).eq("id", conversationId).eq("establishment_id", this.context.establishmentId); }
  async getStatus() { return { available: true }; }
  abstract normalizeInbound(payload: Record<string, unknown>): Promise<NormalizedMessage[]>;
  async normalizeOutbound(payload: ChannelSendInput): Promise<NormalizedMessage> { return makeMessage(this.context, this.channel, payload.clientRequestId, "outbound", payload.text, "pending", { actor_user_id: payload.actorUserId }); }
}

export class WhatsAppAdapter extends BaseAdapter {
  readonly channel = "whatsapp" as const;
  async normalizeInbound(payload: Record<string, unknown>) { return [makeMessage(this.context, this.channel, String(payload.messageId), "inbound", String(payload.text || ""), "received", payload.metadata as Record<string, unknown> || {})]; }
  async send(_payload: ChannelSendInput): Promise<ChannelSendResult> { throw new Error("O envio WhatsApp usa o serviço oficial existente para preservar assinatura, status e retries."); }
}

export class VoiceAdapter extends BaseAdapter {
  readonly channel = "voice" as const;
  async normalizeInbound(payload: Record<string, unknown>) { return [makeMessage(this.context, this.channel, String(payload.eventId), payload.speaker === "human" ? "outbound" : "inbound", String(payload.text || ""), "received", { event_type: payload.eventType, confidence: payload.confidence })]; }
  async send(_payload: ChannelSendInput): Promise<ChannelSendResult> { throw new Error("Respostas de voz são devolvidas ao provider pela sessão telefônica ativa."); }
}

export class WebChatAdapter extends BaseAdapter {
  readonly channel = "web_chat" as const;
  async normalizeInbound(payload: Record<string, unknown>) { return [makeMessage(this.context, this.channel, String(payload.messageId), "inbound", String(payload.text || ""), "received", payload.metadata as Record<string, unknown> || {})]; }
  async send(payload: ChannelSendInput) {
    const normalized = await this.normalizeOutbound(payload);
    normalized.status = "sent";
    const saved = await persistNormalized(this.context.admin, normalized);
    return { messageId: saved, status: "sent" as const };
  }
}

function makeMessage(context: AdapterContext, channel: ChannelType, channelMessageId: string, direction: "inbound" | "outbound", text: string, status: "received" | "pending", metadata: Record<string, unknown>): NormalizedMessage {
  return { channel, channelMessageId, organizationId: context.organizationId, establishmentId: context.establishmentId, customerId: context.customerId, conversationId: context.conversationId, channelThreadId: context.channelThreadId, channelId: context.channelId, direction, type: channel === "voice" ? "call" : "text", text: text.slice(0, 4096), media: [], status, timestamp: new Date().toISOString(), metadata };
}

export async function persistNormalized(admin: SupabaseClient, message: NormalizedMessage) {
  const { data, error } = await admin.from("normalized_messages").upsert({ channel_id: message.channelId, channel_thread_id: message.channelThreadId, channel_type: message.channel, channel_message_id: message.channelMessageId, organization_id: message.organizationId, establishment_id: message.establishmentId, customer_id: message.customerId || null, conversation_id: message.conversationId, direction: message.direction, message_type: message.type, text_content: message.text || null, media: message.media || [], status: message.status, metadata: message.metadata || {}, occurred_at: message.timestamp }, { onConflict: "channel_id,channel_message_id", ignoreDuplicates: true }).select("id").maybeSingle();
  if (error) throw error;
  await admin.from("omnichannel_conversations").update({ current_channel: message.channel, last_touch_channel: message.channel, last_message_preview: message.text?.slice(0, 240) || `[${message.type}]`, last_message_at: message.timestamp, updated_at: message.timestamp }).eq("id", message.conversationId).eq("establishment_id", message.establishmentId);
  return String(data?.id || "");
}

