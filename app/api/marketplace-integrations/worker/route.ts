import { NextResponse } from "next/server";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createAdminClient } from "@/lib/supabase/admin";
import { calculateBackoff, matchMarketplaceProduct, payloadHash } from "@/lib/marketplace-integrations/core";

type Claimed = { event_id: string; organization_id: string; connection_id: string; store_connection_id?: string | null; provider_event_id: string; event_type: string; raw_payload: string; attempt_count: number; correlation_id: string };

export async function POST(request: Request) {
  const configured = process.env.MARKETPLACE_WORKER_TOKEN;
  if (!configured || request.headers.get("x-masterapp-worker") !== configured) return NextResponse.json({ ok: false }, { status: 401 });
  const admin = createAdminClient(); const { data, error } = await admin.rpc("claim_marketplace_webhook_payloads", { requested_limit: 20 });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const results: Array<Record<string, unknown>> = [];
  for (const event of (data || []) as Claimed[]) {
    try {
      const payload = JSON.parse(event.raw_payload) as any;
      if (!["order.created", "order.new", "order.updated"].includes(event.event_type)) {
        await admin.from("marketplace_webhook_events").update({ status: "processed", processed_at: new Date().toISOString() }).eq("id", event.event_id);
        results.push({ event_id: event.event_id, ignored: true }); continue;
      }
      let storeConnection: any = null;
      if (event.store_connection_id) ({ data: storeConnection } = await admin.from("marketplace_store_connections").select("id,store_id").eq("id", event.store_connection_id).single());
      if (!storeConnection) ({ data: storeConnection } = await admin.from("marketplace_store_connections").select("id,store_id").eq("connection_id", event.connection_id).eq("external_store_id", String(payload.external_store_id || payload.store?.id || "")).eq("status", "active").maybeSingle());
      if (!storeConnection) throw new Error("store_mapping_missing");
      const externalItems = Array.isArray(payload.items) ? payload.items : [];
      const externalIds = externalItems.map((item: any) => String(item.external_id || item.id || "")).filter(Boolean);
      const { data: mappings } = await admin.from("marketplace_product_mappings").select("external_item_id,internal_product_id,status").eq("connection_id", event.connection_id).eq("store_id", storeConnection.store_id).in("external_item_id", externalIds);
      const mappingMap = new Map((mappings || []).filter((m: any) => m.status === "confirmed").map((m: any) => [m.external_item_id, m.internal_product_id]));
      const normalizedItems = externalItems.map((item: any) => ({ external_id: String(item.external_id || item.id || ""), product_id: mappingMap.get(String(item.external_id || item.id || "")), quantity: Number(item.quantity || 1), addon_ids: Array.isArray(item.addon_ids) ? item.addon_ids : [] }));
      if (normalizedItems.some((item: any) => !item.product_id)) {
        for (const item of externalItems) {
          const externalId = String(item.external_id || item.id || ""); if (mappingMap.has(externalId)) continue;
          const { data: products } = await admin.from("products").select("id,sku,barcode,name").eq("establishment_id", storeConnection.store_id).eq("active", true).limit(500);
          const suggestion = matchMarketplaceProduct({ externalId, sku: item.sku, barcode: item.barcode, externalReference: item.external_reference, name: item.name }, (products || []).map((p: any) => ({ ...p, externalReference: null })));
          await admin.from("marketplace_product_mappings").upsert({ organization_id: event.organization_id, connection_id: event.connection_id, store_id: storeConnection.store_id, external_item_id: externalId, internal_product_id: suggestion.internalId, mapping_method: suggestion.method, status: suggestion.reviewRequired ? "pending_review" : "confirmed", confidence: suggestion.reviewRequired ? 0.5 : 1 }, { onConflict: "connection_id,store_id,external_item_id" });
        }
        throw new Error("unmapped_product_manual_review");
      }
      const normalized = { customer_name: payload.customer?.name || "Cliente do marketplace", customer_phone: payload.customer?.phone || null, fulfillment_type: payload.fulfillment_type || "delivery", items: normalizedItems, notes: payload.notes || null, payment_method: payload.payment_method || "marketplace", delivery_address: payload.delivery_address || null, status: payload.status || "new" };
      const financial = payload.financial || { total_cents: payload.total_cents, commission_cents: payload.commission_cents };
      const { data: created, error: ingestError } = await admin.rpc("marketplace_ingest_order", { requested_connection: event.connection_id, requested_store: storeConnection.store_id, requested_external_order_id: String(payload.external_order_id || payload.id), requested_external_display_id: String(payload.display_id || payload.external_order_id || payload.id), requested_payload: normalized, requested_financial: financial, requested_event: event.event_id, requested_hash: payloadHash(JSON.stringify(payload)), requested_correlation: event.correlation_id, requested_environment: payload.environment === "sandbox" ? "sandbox" : "production" });
      if (ingestError) throw ingestError;
      await admin.from("marketplace_webhook_events").update({ status: "processed", processed_at: new Date().toISOString(), last_error: null }).eq("id", event.event_id);
      results.push({ event_id: event.event_id, order_id: created?.order_id, duplicate: created?.duplicate });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "processing_failed"; const terminal = event.attempt_count >= 8 || message.includes("manual_review");
      await admin.from("marketplace_webhook_events").update({ status: terminal ? "dead_letter" : "failed", next_attempt_at: new Date(Date.now() + calculateBackoff(event.attempt_count) * 1000).toISOString(), last_error: message.slice(0, 500) }).eq("id", event.event_id);
      results.push({ event_id: event.event_id, error: message, dead_letter: terminal });
    }
  }
  return NextResponse.json({ ok: true, processed: results.length, results });
}
