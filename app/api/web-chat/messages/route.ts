import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processWebChatAutomation } from "@/lib/omnichannel/web-chat";

export async function GET(request: Request) {
  const url = new URL(request.url); const publicKey = url.searchParams.get("public_key") || ""; const token = url.searchParams.get("token") || ""; const origin = url.searchParams.get("origin") || "";
  if (!publicKey || !token || !origin) return NextResponse.json({ error: "Sessão inválida." }, { status: 400 });
  const { data, error } = await createAdminClient().rpc("get_web_chat_history", { requested_public_key: publicKey, requested_token: token, requested_origin: origin });
  return error ? NextResponse.json({ error: error.message }, { status: 403 }) : NextResponse.json({ messages: data }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { public_key?: string; token?: string; origin?: string; message_id?: string; text?: string; session_id?: string };
    const text = String(body.text || "").trim().slice(0, 4096); const messageId = String(body.message_id || "").slice(0, 160);
    if (!body.public_key || !body.token || !body.origin || !messageId || !text || !body.session_id) return NextResponse.json({ error: "Mensagem inválida." }, { status: 400 });
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("post_web_chat_message", { requested_public_key: body.public_key, requested_token: body.token, requested_origin: body.origin, requested_message_id: messageId, requested_text: text });
    if (error) return NextResponse.json({ error: error.message }, { status: error.message.includes("Limite") ? 429 : 403 });
    try { await processWebChatAutomation(admin, { sessionId: String(body.session_id), inboundMessageId: messageId, text }); }
    catch { /* The visitor message remains durable and visible to the human team. */ }
    return NextResponse.json(data);
  } catch { return NextResponse.json({ error: "Não foi possível enviar a mensagem." }, { status: 500 }); }
}

