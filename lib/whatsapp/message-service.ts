import type { SupabaseClient } from "@supabase/supabase-js";
import { sendWhatsAppText } from "./cloud-api";
import type { WhatsAppConnectionSecret } from "./types";

export async function sendStoredWhatsAppText(input: {
  admin: SupabaseClient; establishmentId: string; connectionId: string; conversationId: string;
  contactId: string; waId: string; text: string; sentByUserId?: string | null;
  clientRequestId?: string | null; automationGenerated?: boolean;
}) {
  const text=input.text.trim().slice(0,4096);
  const { data:connection }=await input.admin.from("whatsapp_connections").select("id,phone_number_id,graph_api_version,status").eq("id",input.connectionId).eq("establishment_id",input.establishmentId).eq("status","connected").single();
  if (!connection) throw new Error("WhatsApp não está conectado.");
  const { data:pending,error:insertError }=await input.admin.from("whatsapp_messages").insert({
    establishment_id:input.establishmentId,conversation_id:input.conversationId,contact_id:input.contactId,
    client_request_id:input.clientRequestId || null,direction:"outbound",message_type:"text",content:text,status:"pending",
    sent_by_user_id:input.sentByUserId || null,automation_generated:Boolean(input.automationGenerated),
  }).select("id,status").single();
  if (insertError || !pending) throw new Error("Não foi possível registrar a mensagem.");
  try {
    const { data:secrets }=await input.admin.rpc("get_whatsapp_connection_secret",{requested_connection_id:input.connectionId});
    const secure=secrets as WhatsAppConnectionSecret|null;
    if (!secure?.access_token) throw new Error("Credencial da conexão indisponível.");
    const sent=await sendWhatsAppText({phoneNumberId:connection.phone_number_id,accessToken:secure.access_token,graphApiVersion:connection.graph_api_version,to:input.waId,text});
    const now=new Date().toISOString();
    const { data:message }=await input.admin.from("whatsapp_messages").update({whatsapp_message_id:sent.messageId,status:"sent",message_timestamp:now}).eq("id",pending.id).eq("establishment_id",input.establishmentId).select("*").single();
    await input.admin.from("whatsapp_conversations").update({last_message_id:pending.id,last_message_preview:text.slice(0,180),last_message_at:now,...(input.automationGenerated?{last_ai_response_at:now}:{})}).eq("id",input.conversationId).eq("establishment_id",input.establishmentId);
    return message;
  } catch(error) {
    const safe=error instanceof Error?error:new Error("Falha no envio.");
    await input.admin.from("whatsapp_messages").update({status:"failed",error_code:(safe as Error & {code?:string}).code||null,error_message:safe.message.slice(0,500)}).eq("id",pending.id).eq("establishment_id",input.establishmentId);
    throw safe;
  }
}

