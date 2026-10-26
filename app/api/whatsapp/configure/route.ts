import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const supabase = await createClient();
    const establishmentId = String(body.establishment_id || "");
    if (body.action === "add") {
      const { data, error } = await supabase.rpc("add_whatsapp_connection", {
        requested_establishment_id: establishmentId,
        requested_label: String(body.label || "WhatsApp"),
        requested_routing_mode: String(body.routing_mode || "store"),
        requested_phone_number_id: String(body.phone_number_id || ""), requested_waba_id: String(body.whatsapp_business_account_id || ""),
        requested_display_phone: String(body.display_phone_number || ""), requested_verified_name: String(body.verified_name || ""),
        requested_access_token: String(body.access_token || ""), requested_app_secret: String(body.app_secret || ""),
        requested_verify_token: String(body.verify_token || ""), requested_graph_api_version: String(body.graph_api_version || "v23.0"),
        requested_primary: Boolean(body.is_primary),
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ connection: data });
    }
    if (body.action === "disconnect_by_id") {
      const { error } = await supabase.rpc("disconnect_whatsapp_connection_by_id", { requested_connection_id: String(body.connection_id || "") });
      if (error) return NextResponse.json({ error: error.message }, { status: 403 });
      return NextResponse.json({ disconnected: true });
    }
    if (body.action === "disconnect") {
      const { error } = await supabase.rpc("disconnect_whatsapp_connection", { requested_establishment_id: establishmentId });
      if (error) return NextResponse.json({ error: error.message }, { status: 403 });
      return NextResponse.json({ disconnected: true });
    }
    const { data, error } = await supabase.rpc("configure_whatsapp_connection", {
      requested_establishment_id: establishmentId,
      requested_phone_number_id: String(body.phone_number_id || ""), requested_waba_id: String(body.whatsapp_business_account_id || ""),
      requested_display_phone: String(body.display_phone_number || ""), requested_verified_name: String(body.verified_name || ""),
      requested_access_token: String(body.access_token || "") || null, requested_app_secret: String(body.app_secret || "") || null,
      requested_verify_token: String(body.verify_token || "") || null, requested_graph_api_version: String(body.graph_api_version || "v23.0"),
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ connection: data });
  } catch {
    return NextResponse.json({ error: "Não foi possível salvar a conexão." }, { status: 500 });
  }
}

