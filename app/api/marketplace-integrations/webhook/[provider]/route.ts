import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { payloadHash, redactMarketplacePayload, verifyMarketplaceWebhook } from "@/lib/marketplace-integrations/core";

export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody) > 524288) return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  const { provider } = await context.params; const connectionId = request.headers.get("x-masterapp-connection") || "";
  const eventId = request.headers.get("x-event-id") || ""; const timestamp = request.headers.get("x-timestamp") || ""; const signature = request.headers.get("x-signature") || "";
  if (!connectionId || !eventId) return NextResponse.json({ ok: false, error: "missing_headers" }, { status: 400 });
  const admin = createAdminClient();
  const { data: connection } = await admin.from("marketplace_connections").select("id,organization_id,status,provider_id,marketplace_provider_definitions!inner(provider_key)").eq("id", connectionId).eq("marketplace_provider_definitions.provider_key", provider).maybeSingle();
  if (!connection || !["active", "degraded"].includes(connection.status)) return NextResponse.json({ ok: false, error: "connection_not_found" }, { status: 404 });
  const { data: secretConfig, error: secretError } = await admin.rpc("get_marketplace_connection_secret", { requested_connection: connection.id });
  if (secretError || !secretConfig) return NextResponse.json({ ok: false, error: "secret_unavailable" }, { status: 503 });
  let config: Record<string, string> = {}; try { config = JSON.parse(secretConfig); } catch { return NextResponse.json({ ok: false, error: "invalid_secret_config" }, { status: 503 }); }
  if (!verifyMarketplaceWebhook({ rawBody, signature, timestamp, secret: config.webhook_secret })) return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401 });
  let parsed: Record<string, unknown>; try { parsed = JSON.parse(rawBody); } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const minuteAgo = new Date(Date.now() - 60_000).toISOString();
  const { count } = await admin.from("marketplace_webhook_events").select("id", { count: "exact", head: true }).eq("connection_id", connection.id).gte("received_at", minuteAgo);
  if ((count || 0) >= 300) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } });
  const externalStoreId = String(parsed.external_store_id || (parsed.store as Record<string, unknown> | undefined)?.id || "");
  const { data: storeConnection } = externalStoreId ? await admin.from("marketplace_store_connections").select("id").eq("connection_id", connection.id).eq("external_store_id", externalStoreId).eq("status", "active").maybeSingle() : { data: null };
  const correlationId = request.headers.get("x-correlation-id") || crypto.randomUUID();
  const { data: event, error } = await admin.from("marketplace_webhook_events").insert({ organization_id: connection.organization_id, connection_id: connection.id, store_connection_id: storeConnection?.id || null, provider_event_id: eventId, event_type: String(parsed.type || "unknown"), signature_verified: true, replay_verified: true, payload_hash: payloadHash(rawBody), redacted_metadata: redactMarketplacePayload({ type: parsed.type, external_order_id: parsed.external_order_id, external_store_id: externalStoreId }), correlation_id: correlationId }).select("id").single();
  if (error?.code === "23505") return NextResponse.json({ ok: true, duplicate: true }, { status: 202 });
  if (error || !event) return NextResponse.json({ ok: false, error: "event_persist_failed" }, { status: 500 });
  const { error: storeError } = await admin.rpc("store_marketplace_webhook_payload", { requested_event: event.id, requested_raw: rawBody });
  if (storeError) { await admin.from("marketplace_webhook_events").update({ status: "failed", last_error: "payload_storage_failed" }).eq("id", event.id); return NextResponse.json({ ok: false, error: "payload_storage_failed" }, { status: 500 }); }
  return NextResponse.json({ ok: true, accepted: true, event_id: event.id }, { status: 202 });
}
