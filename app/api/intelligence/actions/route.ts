import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const establishmentId = String(body.establishment_id || "");
    if (!uuid.test(establishmentId)) return NextResponse.json({ error: "Unidade inválida." }, { status: 400 });
    const supabase = await createClient();
    const { data: claims } = await (supabase.auth as any).getClaims();
    if (!claims?.claims?.sub) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
    const operation = String(body.operation || "list");
    if (operation === "list") {
      const { data, error } = await supabase.rpc("list_copilot_actions", { requested_establishment_id: establishmentId, requested_limit: 50 });
      if (error) return NextResponse.json({ error: error.message }, { status: 403 });
      return NextResponse.json({ history: data });
    }
    if (operation === "settings") {
      const { data, error } = await supabase.rpc("configure_copilot_action_settings", { requested_establishment_id: establishmentId, requested_mode: String(body.mode || "standard"), requested_limit: Number(body.common_action_limit || 10) });
      if (error) return NextResponse.json({ error: error.message }, { status: 403 });
      return NextResponse.json({ settings: data });
    }
    const actionId = String(body.action_id || "");
    if (!uuid.test(actionId)) return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
    if (operation === "confirm") {
      const token = String(body.confirmation_token || "");
      if (!uuid.test(token)) return NextResponse.json({ error: "Confirmação inválida." }, { status: 400 });
      const { data, error } = await supabase.rpc("confirm_copilot_action", { requested_action_id: actionId, requested_confirmation_token: token, requested_confirmation_text: String(body.confirmation_text || "") || null });
      if (error) return NextResponse.json({ error: error.message }, { status: 409 });
      return NextResponse.json({ result: data });
    }
    if (operation === "cancel") {
      const { error } = await supabase.rpc("cancel_copilot_action", { requested_action_id: actionId });
      if (error) return NextResponse.json({ error: error.message }, { status: 409 });
      return NextResponse.json({ result: { status: "cancelled", message: "A ação foi cancelada." } });
    }
    if (operation === "undo") {
      const { data, error } = await supabase.rpc("undo_copilot_action", { requested_action_id: actionId });
      if (error) return NextResponse.json({ error: error.message }, { status: 409 });
      return NextResponse.json({ result: data });
    }
    return NextResponse.json({ error: "Operação não permitida." }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Não foi possível concluir a ação com segurança." }, { status: 500 });
  }
}
