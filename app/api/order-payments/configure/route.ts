import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("configure_payment_gateway", {
      requested_establishment_id: String(body.establishment_id || ""),
      requested_provider: String(body.provider || ""),
      requested_active: Boolean(body.active),
      requested_environment: String(body.environment || "test"),
      requested_secret: String(body.secret || "") || null,
      requested_webhook_secret: String(body.webhook_secret || "") || null,
      requested_merchant_account_id: String(body.merchant_account_id || "") || null,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ account: data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao salvar o gateway." }, { status: 500 });
  }
}
