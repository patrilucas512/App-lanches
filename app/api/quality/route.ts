import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { correlationId, structuredLog } from "@/lib/observability/core";

async function requireQualityAdmin() {
  const client = await createClient();
  const { data } = await client.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) throw new Error("unauthorized");
  const { data: profile } = await client.from("profiles").select("is_superadmin").eq("id", userId).maybeSingle();
  if (!profile?.is_superadmin) throw new Error("forbidden");
  return String(userId);
}

export async function GET() {
  try {
    await requireQualityAdmin(); const admin = createAdminClient();
    const [{ data: summary, error }, { data: flags }, { data: releases }, { data: suites }, { data: regressions }] = await Promise.all([
      admin.rpc("get_quality_summary"),
      admin.from("quality_feature_flags").select("*").order("flag_key"),
      admin.from("platform_releases").select("*").order("created_at", { ascending: false }).limit(20),
      admin.from("qa_suite_runs").select("*").order("created_at", { ascending: false }).limit(30),
      admin.from("qa_regressions").select("*").order("detected_at", { ascending: false }).limit(30),
    ]);
    if (error) throw error;
    return NextResponse.json({ summary, flags: flags || [], releases: releases || [], suites: suites || [], regressions: regressions || [] }, { headers: { "cache-control": "private, max-age=10" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Falha." }, { status: 403 }); }
}

export async function POST(request: Request) {
  const id = correlationId(request.headers.get("x-correlation-id"));
  try {
    const userId = await requireQualityAdmin(); const body = await request.json();
    if (body.confirmed !== true) return NextResponse.json({ error: "Confirmação reforçada obrigatória." }, { status: 409 });
    const action = String(body.action || ""); const admin = createAdminClient(); let result: unknown;
    if (action === "feature_flag") {
      const response = await admin.rpc("set_quality_feature_flag", {
        requested_flag_key: String(body.flag_key || ""), requested_enabled: Boolean(body.enabled), requested_kill_switch: Boolean(body.kill_switch),
        requested_rollout_percent: Number(body.rollout_percent || 0), requested_internal_only: body.internal_only !== false,
        requested_target_organizations: body.target_organization_ids || [], requested_target_plans: body.target_plan_codes || [],
      }); if (response.error) throw response.error; result = response.data;
    } else if (action === "deploy_freeze") {
      const reason = String(body.reason || "").trim(); if (reason.length < 10) return NextResponse.json({ error: "Informe um motivo com pelo menos 10 caracteres." }, { status: 400 });
      const response = await admin.rpc("set_deploy_freeze", { requested_environment: body.environment, requested_frozen: Boolean(body.frozen), requested_reason: reason });
      if (response.error) throw response.error; result = response.data;
    } else if (action === "rollback") {
      const reason = String(body.reason || "").trim(); if (reason.length < 10) return NextResponse.json({ error: "O rollback exige justificativa detalhada." }, { status: 400 });
      const response = await admin.rpc("request_release_rollback", { requested_release_id: body.release_id, requested_reason: reason });
      if (response.error) throw response.error; result = response.data;
    } else return NextResponse.json({ error: "Ação não suportada." }, { status: 400 });
    structuredLog("info", "quality", "controlled_action", { user_id: userId, correlation_id: id, action });
    return NextResponse.json({ ok: true, result, correlation_id: id });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Falha." }, { status: 403 }); }
}
