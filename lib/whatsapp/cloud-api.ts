import { createHmac, timingSafeEqual } from "node:crypto";
import { runtimeEnvironment } from "@/lib/quality/core";

export function verifyMetaSignature(rawBody: string, signature: string | null, appSecret: string) {
  if (!signature?.startsWith("sha256=") || !appSecret) return false;
  const received = signature.slice(7);
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  return received.length === expected.length && timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

export async function sendWhatsAppText(input: { phoneNumberId: string; accessToken: string; graphApiVersion: string; to: string; text: string }) {
  if (runtimeEnvironment() !== "production") {
    const recipients = (process.env.WHATSAPP_TEST_RECIPIENTS || "").split(",").map(value => value.trim()).filter(Boolean);
    if (!recipients.includes(input.to)) throw new Error("WhatsApp outbound is restricted to test recipients outside production.");
  }
  const response = await fetch(`https://graph.facebook.com/${input.graphApiVersion}/${encodeURIComponent(input.phoneNumberId)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: input.to, type: "text", text: { preview_url: false, body: input.text } }),
  });
  const body = await response.json() as { messages?: Array<{ id?: string }>; error?: { message?: string; code?: number } };
  if (!response.ok || !body.messages?.[0]?.id) {
    const error = new Error(body.error?.message || "A Meta não aceitou a mensagem.") as Error & { code?: string };
    error.code = body.error?.code ? String(body.error.code) : String(response.status);
    throw error;
  }
  return { messageId: body.messages[0].id };
}

