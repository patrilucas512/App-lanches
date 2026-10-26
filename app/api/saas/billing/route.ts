import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function context(organizationId: string) {
  const supabase = await createClient();
  const { data: claims } = await (supabase.auth as any).getClaims();
  if (!claims?.claims?.sub) throw new Error("Faça login novamente.");
  const { data: member } = await supabase.from("organization_members").select("role,active").eq("organization_id", organizationId).eq("user_id", claims.claims.sub).maybeSingle();
  if (!member?.active) throw new Error("Você não possui acesso a esta organização.");
  return supabase;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { organization_id?: string; action?: string; plan_id?: string; reason?: string; consent?: Record<string, unknown> };
    const organizationId = String(body.organization_id || "");
    const supabase = await context(organizationId);
    if (body.action === "preview_plan") {
      const { data, error } = await supabase.rpc("preview_saas_plan_change", { requested_organization_id: organizationId, requested_plan_id: body.plan_id });
      if (error) throw error; return NextResponse.json(data);
    }
    if (body.action === "change_plan") {
      const { data, error } = await supabase.rpc("request_saas_plan_change", { requested_organization_id: organizationId, requested_plan_id: body.plan_id, requested_consent: body.consent || {} });
      if (error) throw error; return NextResponse.json(data);
    }
    if (["cancel", "reactivate"].includes(String(body.action))) {
      const { data, error } = await supabase.rpc("manage_saas_subscription", { requested_organization_id: organizationId, requested_action: body.action, requested_reason: body.reason || null });
      if (error) throw error; return NextResponse.json(data);
    }
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível atualizar a cobrança." }, { status: 403 });
  }
}

