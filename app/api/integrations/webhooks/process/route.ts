import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateWebhookUrl } from "@/lib/integrations/security";

export async function POST(request: Request) {
  const admin = createAdminClient(); const token = request.headers.get("x-masterapp-worker") || ""; const { data: allowed } = await admin.rpc("verify_integration_worker_token", { requested_token: token });
  if (!allowed) return NextResponse.json({ error: "Worker não autorizado." }, { status: 401 });
  const body = await request.json().catch(() => ({})); const { data: deliveries, error } = await admin.rpc("claim_webhook_deliveries", { requested_limit: Math.min(Number(body.limit || 20), 50) }); if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const results = [];
  for (const delivery of deliveries || []) {
    const started = Date.now(); let status = 0; let excerpt = ""; let failure = "";
    try {
      const url = validateWebhookUrl(delivery.url); const timestamp = Math.floor(Date.now() / 1000); const payload = JSON.stringify({ id: delivery.event_id, type: delivery.event_type, created_at: new Date().toISOString(), data: delivery.payload }); const signature = createHmac("sha256", delivery.signing_secret).update(`${timestamp}.${payload}`).digest("hex");
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "user-agent": "MasterApp-Webhooks/1.0", "x-masterapp-event-id": delivery.event_id, "x-masterapp-delivery-id": delivery.delivery_id, "x-masterapp-signature": `t=${timestamp},v1=${signature}` }, body: payload, signal: AbortSignal.timeout(10_000), redirect: "error" }); status = response.status; excerpt = (await response.text()).slice(0, 1000); if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (cause) { failure = cause instanceof Error ? cause.message : "Falha desconhecida"; }
    const success = !failure && status >= 200 && status < 300; await admin.rpc("finish_webhook_delivery", { requested_delivery_id: delivery.delivery_id, requested_success: success, requested_http_status: status || null, requested_latency_ms: Date.now() - started, requested_response_excerpt: excerpt, requested_error: failure }); results.push({ id: delivery.delivery_id, success, status });
  }
  return NextResponse.json({ processed: results.length, results });
}
