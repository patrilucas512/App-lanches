import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { public_key?: string; token?: string; origin?: string };
    const publicKey = String(body.public_key || "");
    const origin = String(body.origin || request.headers.get("origin") || "").slice(0, 300);
    if (!/^[0-9a-f-]{36}$/i.test(publicKey) || !origin) return NextResponse.json({ error: "Widget inválido." }, { status: 400 });
    const { data, error } = await createAdminClient().rpc("start_web_chat_session", { requested_public_key: publicKey, requested_origin: origin, requested_existing_token: body.token || null });
    if (error) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Não foi possível iniciar o atendimento." }, { status: 500 }); }
}

