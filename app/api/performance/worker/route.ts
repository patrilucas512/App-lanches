import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processWhatsAppAutomation } from "@/lib/ai-attendant/orchestrator";
import { correlationId, structuredLog, withTrace } from "@/lib/observability/core";

export async function POST(request: Request) {
  const admin = createAdminClient(); const token = request.headers.get("x-masterapp-worker") || "";
  const { data: allowed } = await admin.rpc("verify_integration_worker_token", { requested_token: token });
  if (!allowed) return NextResponse.json({ error: "Worker não autorizado." }, { status: 401 });
  const body = await request.json().catch(() => ({})); const worker = String(body.worker || `worker-${crypto.randomUUID()}`); const queue = String(body.queue || "default");
  const { data: jobs, error } = await admin.rpc("claim_operational_jobs", { requested_worker: worker, requested_queue: queue, requested_limit: Math.min(50, Math.max(1, Number(body.limit || 10))), requested_lease_seconds: 90 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const results = [];
  for (const job of jobs || []) {
    const cid = correlationId(job.correlation_id); let success = false; let result: unknown = null; let failure: unknown = null;
    try {
      result = await withTrace({ service: "worker", operation: String(job.job_type), correlationId: cid, organizationId: job.organization_id, storeId: job.store_id }, async () => {
        if (job.job_type === "whatsapp_automation") { await processWhatsAppAutomation({ connectionId: String(job.payload.connection_id), messageId: String(job.payload.message_id) }); return { processed: true }; }
        if (job.job_type === "cache_invalidation") { const response = await admin.rpc("invalidate_cache_namespace", { requested_namespace: String(job.payload.namespace || "settings"), requested_organization_id: job.organization_id, requested_store_id: job.store_id, requested_reason: "Evento processado pelo worker" }); if (response.error) throw response.error; return { version: response.data }; }
        if (job.job_type === "metric_rollup") return { processed: true };
        throw new Error(`Tipo de job não suportado: ${job.job_type}`);
      }); success = true;
    } catch (errorValue) { failure = errorValue; }
    const finished = await admin.rpc("finish_operational_job", { requested_job_id: job.id, requested_worker: worker, requested_success: success, requested_result: result || {}, requested_error_code: failure instanceof Error ? failure.name : null, requested_error_message: failure instanceof Error ? failure.message : null });
    results.push({ id: job.id, success, status: finished.data });
  }
  structuredLog("info", "worker", "batch_completed", { correlation_id: correlationId(request.headers.get("x-correlation-id")), queue, worker, processed: results.length });
  return NextResponse.json({ processed: results.length, results });
}
