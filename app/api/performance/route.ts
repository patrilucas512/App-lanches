import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { correlationId, structuredLog } from "@/lib/observability/core";

async function requireInternal() {
  const client = await createClient(); const { data } = await client.auth.getClaims(); const userId = data?.claims?.sub;
  if (!userId) throw new Error("unauthorized");
  const { data: profile } = await client.from("profiles").select("is_superadmin").eq("id", userId).maybeSingle();
  if (!profile?.is_superadmin) throw new Error("forbidden"); return { userId };
}

export async function GET(request: Request) {
  try {
    await requireInternal(); const admin = createAdminClient();
    const [{ data: summary, error }, { data: slos }, { data: dlq }, { data: releases }] = await Promise.all([
      admin.rpc("get_performance_summary"), admin.from("performance_slos").select("*").eq("enabled", true).order("service_key"),
      admin.from("operational_dead_letters").select("id,job_type,queue_name,attempt_count,error_code,error_message,failed_at,organization_id").is("reprocessed_at", null).order("failed_at", { ascending: false }).limit(50),
      admin.from("release_performance_snapshots").select("*").order("created_at", { ascending: false }).limit(10),
    ]);
    if (error) throw error;
    return NextResponse.json({ summary, slos: slos || [], dlq: dlq || [], releases: releases || [] }, { headers: { "cache-control": "private, max-age=15" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Falha." }, { status: 403 }); }
}

export async function POST(request: Request) {
  const id = correlationId(request.headers.get("x-correlation-id"));
  try {
    const { userId } = await requireInternal(); const body = await request.json(); const action = String(body.action || "");
    if (!body.confirmed) return NextResponse.json({ error: "Confirmação reforçada obrigatória." }, { status: 409 });
    const admin = createAdminClient(); let result: unknown;
    if (action === "retry_dlq") { const response = await admin.rpc("retry_dead_letter_job", { requested_dead_letter_id: body.id }); if (response.error) throw response.error; result = response.data; }
    else if (action === "invalidate_cache") { const response = await admin.rpc("invalidate_cache_namespace", { requested_namespace: String(body.namespace || "settings"), requested_organization_id: body.organization_id || null, requested_store_id: body.store_id || null, requested_reason: "Ação confirmada no Performance Command Center" }); if (response.error) throw response.error; result = response.data; }
    else if (action === "set_degraded_mode") { const capability = String(body.capability || "analytics"); if (["orders","payments","kitchen"].includes(capability) && body.mode !== "normal") return NextResponse.json({ error: "Caminho crítico não pode ser degradado por esta ação rápida." }, { status: 400 }); const response = await admin.from("degradation_controls").update({ mode: body.mode === "normal" ? "normal" : "degraded", reason: String(body.reason || "Operação manual confirmada"), enabled_at: body.mode === "normal" ? null : new Date().toISOString(), enabled_by: userId, updated_at: new Date().toISOString() }).eq("capability_key", capability).select().single(); if (response.error) throw response.error; result = response.data; }
    else if (action === "pause_low_priority") { const response = await admin.from("degradation_controls").update({ mode: "paused", reason: "Proteção contra sobrecarga confirmada", enabled_at: new Date().toISOString(), enabled_by: userId, updated_at: new Date().toISOString() }).in("capability_key", ["campaigns","analytics"]).select(); if (response.error) throw response.error; result = response.data; }
    else return NextResponse.json({ error: "Ação não suportada." }, { status: 400 });
    structuredLog("info", "performance", "safe_action", { user_id: userId, correlation_id: id, action });
    return NextResponse.json({ ok: true, result, correlation_id: id });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Falha." }, { status: 403 }); }
}
