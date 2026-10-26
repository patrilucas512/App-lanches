import type { SupabaseClient } from "@supabase/supabase-js";
import { VoiceAdapter, WhatsAppAdapter } from "./adapters";

async function ensureThread(admin: SupabaseClient, establishmentId: string, channelType: "whatsapp" | "voice", externalId: string, customerId: string | null, legacyColumn: "whatsapp_conversation_id" | "voice_call_id") {
  const { data: establishment, error: establishmentError } = await admin.from("establishments").select("organization_id").eq("id", establishmentId).single();
  if (establishmentError) throw establishmentError;
  const { data: channel, error: channelError } = await admin.from("channels").select("id").eq("establishment_id", establishmentId).eq("channel_type", channelType).single();
  if (channelError) throw channelError;
  let { data: conversation } = await admin.from("omnichannel_conversations").select("id,customer_id").eq(legacyColumn, externalId).maybeSingle();
  if (!conversation) {
    if (customerId) {
      const { data: existingCustomerConversation } = await admin.from("omnichannel_conversations").select("id,customer_id").eq("establishment_id", establishmentId).eq("customer_id", customerId).neq("status", "resolved").order("last_message_at", { ascending: false }).limit(1).maybeSingle();
      if (existingCustomerConversation) {
        await admin.from("omnichannel_conversations").update({ [legacyColumn]: externalId, current_channel: channelType, last_touch_channel: channelType, updated_at: new Date().toISOString() }).eq("id", existingCustomerConversation.id);
        conversation = existingCustomerConversation;
      }
    }
    if (!conversation) {
      const { data: created, error } = await admin.from("omnichannel_conversations").insert({ organization_id: establishment.organization_id, establishment_id: establishmentId, customer_id: customerId, current_channel: channelType, first_touch_channel: channelType, last_touch_channel: channelType, [legacyColumn]: externalId, last_message_at: new Date().toISOString() }).select("id,customer_id").single();
      if (error) throw error; conversation = created;
    }
  } else if (!conversation.customer_id && customerId) await admin.from("omnichannel_conversations").update({ customer_id: customerId }).eq("id", conversation.id);
  let { data: thread } = await admin.from("channel_threads").select("id").eq("channel_id", channel.id).eq("external_thread_id", externalId).maybeSingle();
  if (!thread) {
    const { data: created, error } = await admin.from("channel_threads").insert({ conversation_id: conversation.id, channel_id: channel.id, organization_id: establishment.organization_id, establishment_id: establishmentId, external_thread_id: externalId }).select("id").single();
    if (error) throw error; thread = created;
  }
  return { organizationId: String(establishment.organization_id), establishmentId, conversationId: String(conversation.id), channelId: String(channel.id), channelThreadId: String(thread.id), customerId };
}

export async function recordWhatsAppInbound(admin: SupabaseClient, input: { establishmentId: string; conversationId: string; messageId: string; text: string; customerId?: string | null; metadata?: Record<string, unknown> }) {
  const context = await ensureThread(admin, input.establishmentId, "whatsapp", input.conversationId, input.customerId || null, "whatsapp_conversation_id");
  return new WhatsAppAdapter({ admin, ...context }).receive({ messageId: input.messageId, text: input.text, metadata: input.metadata || {} });
}

export async function recordVoiceTurn(admin: SupabaseClient, input: { establishmentId: string; callId: string; eventId: string; text: string; customerId?: string | null; eventType: string; confidence?: number; speaker?: string }) {
  const context = await ensureThread(admin, input.establishmentId, "voice", input.callId, input.customerId || null, "voice_call_id");
  return new VoiceAdapter({ admin, ...context }).receive({ eventId: input.eventId, text: input.text, eventType: input.eventType, confidence: input.confidence, speaker: input.speaker || "customer" });
}

export async function completeContinuityFromWhatsApp(admin: SupabaseClient,input:{establishmentId:string;legacyConversationId:string;text:string}){
  const token=input.text.match(/\bCONTINUAR\s+([a-f0-9]{48})\b/i)?.[1];if(!token)return null;
  const{data:canonical}=await admin.from("omnichannel_conversations").select("id").eq("establishment_id",input.establishmentId).eq("whatsapp_conversation_id",input.legacyConversationId).maybeSingle();if(!canonical)return null;
  const{data:thread}=await admin.from("channel_threads").select("id").eq("conversation_id",canonical.id).eq("external_thread_id",input.legacyConversationId).maybeSingle();if(!thread)return null;
  const{data,error}=await admin.rpc("complete_channel_continuity",{requested_token:token,requested_channel_thread_id:thread.id});if(error)return null;return data;
}

