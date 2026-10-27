import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MARKETPLACE_PERMISSIONS, reconcileMarketplacePayout } from "@/lib/marketplace-integrations/core";

async function context(organizationId?: string) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) throw new Error("Não autenticado.");
  const admin = createAdminClient();
  const { data: memberships } = await admin.from("organization_members").select("organization_id,role,active").eq("user_id", userId).eq("active", true);
  const membership = (memberships || []).find(item => !organizationId || item.organization_id === organizationId);
  if (!membership || !["owner", "admin", "manager", "supervisor"].includes(membership.role)) throw new Error("Sem permissão para gerenciar canais.");
  return { admin, userId, organizationId: membership.organization_id as string };
}

async function audit(admin: ReturnType<typeof createAdminClient>, organizationId: string, eventType: string, userId: string, metadata: Record<string, unknown>) {
  await admin.from("marketplace_audit_events").insert({ organization_id: organizationId, event_type: eventType, actor_user_id: userId, correlation_id: crypto.randomUUID(), metadata });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url); const c = await context(url.searchParams.get("organization_id") || undefined);
    const [connections, stores, orders, mappings, syncs, drifts, payouts, health] = await Promise.all([
      c.admin.from("marketplace_connections").select("*,marketplace_provider_definitions(provider_key,display_name),integrations(name,status,last_error)").eq("organization_id", c.organizationId).order("created_at", { ascending: false }),
      c.admin.from("marketplace_store_connections").select("*").eq("organization_id", c.organizationId).order("created_at"),
      c.admin.from("marketplace_order_links").select("*").eq("organization_id", c.organizationId).order("created_at", { ascending: false }).limit(100),
      c.admin.from("marketplace_product_mappings").select("*").eq("organization_id", c.organizationId).order("updated_at", { ascending: false }).limit(100),
      c.admin.from("marketplace_sync_runs").select("*").eq("organization_id", c.organizationId).order("created_at", { ascending: false }).limit(50),
      c.admin.from("marketplace_drift_records").select("*").eq("organization_id", c.organizationId).eq("status", "open").order("detected_at", { ascending: false }).limit(50),
      c.admin.from("marketplace_payouts").select("*").eq("organization_id", c.organizationId).order("created_at", { ascending: false }).limit(50),
      c.admin.from("marketplace_health_samples").select("*").eq("organization_id", c.organizationId).order("sampled_at", { ascending: false }).limit(100),
    ]);
    return NextResponse.json({ ok: true, permissions: MARKETPLACE_PERMISSIONS, connections: connections.data || [], stores: stores.data || [], orders: orders.data || [], mappings: mappings.data || [], syncs: syncs.data || [], drifts: drifts.data || [], payouts: payouts.data || [], health: health.data || [] });
  } catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Falha ao carregar canais." }, { status: 403 }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json(); const c = await context(String(body.organization_id || "")); const action = String(body.action || "");
    if (action === "connect") {
      const { data: provider } = await c.admin.from("marketplace_provider_definitions").select("id,provider_key,official_api_only").eq("provider_key", body.provider_key).eq("active", true).single();
      if (!provider?.official_api_only) throw new Error("Somente provedores com API oficial e homologada podem ser conectados.");
      const secret = String(body.credential || ""); if (secret.length < 24) throw new Error("Credencial inválida.");
      const { data: integration, error: integrationError } = await c.admin.from("integrations").insert({ organization_id: c.organizationId, provider: provider.provider_key, integration_type: "marketplace", name: String(body.name || provider.provider_key), status: "pending", sync_mode: body.sync_mode || "inbound", created_by: c.userId }).select("id").single();
      if (integrationError) throw integrationError;
      const config = JSON.stringify({ access_token: secret, webhook_secret: String(body.webhook_secret || randomBytes(32).toString("hex")), configured_at: new Date().toISOString() });
      const { error: vaultError } = await c.admin.rpc("set_integration_config", { requested_integration_id: integration.id, requested_config: config });
      if (vaultError) { await c.admin.from("integrations").delete().eq("id", integration.id); throw vaultError; }
      const { data: connection, error } = await c.admin.from("marketplace_connections").insert({ organization_id: c.organizationId, integration_id: integration.id, provider_id: provider.id, status: "active", connected_at: new Date().toISOString(), created_by: c.userId }).select("id,status").single();
      if (error) throw error; await c.admin.from("integrations").update({ status: "active", connected_at: new Date().toISOString() }).eq("id", integration.id);
      await audit(c.admin, c.organizationId, "marketplace_connection_created", c.userId, { connection_id: connection.id, provider_key: provider.provider_key });
      return NextResponse.json({ ok: true, connection, warning: "A credencial foi protegida e não poderá ser visualizada." });
    }
    if (action === "map_store") {
      const { data: connection } = await c.admin.from("marketplace_connections").select("id").eq("id", body.connection_id).eq("organization_id", c.organizationId).single(); if (!connection) throw new Error("Conexão inválida.");
      const { data: store } = await c.admin.from("establishments").select("id").eq("id", body.store_id).eq("organization_id", c.organizationId).single(); if (!store) throw new Error("Unidade inválida.");
      const { error } = await c.admin.from("marketplace_store_connections").upsert({ organization_id: c.organizationId, connection_id: connection.id, store_id: store.id, external_store_id: String(body.external_store_id), external_store_name: body.external_store_name || null, status: "active", fulfillment_modes: body.fulfillment_modes || ["delivery"] }, { onConflict: "connection_id,store_id" }); if (error) throw error;
      await audit(c.admin, c.organizationId, "marketplace_store_mapped", c.userId, { connection_id: connection.id, store_id: store.id }); return NextResponse.json({ ok: true });
    }
    if (action === "confirm_product_mapping") {
      const { data: product } = await c.admin.from("products").select("id,establishment_id").eq("id", body.product_id).single(); if (!product) throw new Error("Produto inválido.");
      const { data: store } = await c.admin.from("establishments").select("id").eq("id", product.establishment_id).eq("organization_id", c.organizationId).single(); if (!store) throw new Error("Produto fora do escopo.");
      const { error } = await c.admin.from("marketplace_product_mappings").upsert({ organization_id: c.organizationId, connection_id: body.connection_id, store_id: store.id, external_item_id: String(body.external_item_id), internal_product_id: product.id, mapping_method: "explicit", status: "confirmed", confidence: 1, reviewed_by: c.userId, reviewed_at: new Date().toISOString() }, { onConflict: "connection_id,store_id,external_item_id" }); if (error) throw error;
      await audit(c.admin, c.organizationId, "marketplace_product_mapping_confirmed", c.userId, { external_item_id: body.external_item_id, product_id: product.id }); return NextResponse.json({ ok: true });
    }
    if (action === "preview_sync") {
      const { data, error } = await c.admin.from("marketplace_sync_runs").insert({ organization_id: c.organizationId, connection_id: body.connection_id, store_id: body.store_id || null, sync_type: body.sync_type || "catalog_export", status: "preview", preview: { requested: true, structural_loss_requires_review: true, published_catalog_only: true }, correlation_id: crypto.randomUUID(), created_by: c.userId }).select("*").single(); if (error) throw error;
      await audit(c.admin, c.organizationId, "marketplace_sync_previewed", c.userId, { sync_run_id: data.id }); return NextResponse.json({ ok: true, preview: data });
    }
    if (action === "request_cancellation") {
      const { data: link } = await c.admin.from("marketplace_order_links").select("id").eq("id", body.order_link_id).eq("organization_id", c.organizationId).single(); if (!link) throw new Error("Pedido inválido.");
      const { data, error } = await c.admin.from("marketplace_cancellation_sagas").insert({ organization_id: c.organizationId, order_link_id: link.id, state: "cancel_requested", reason: String(body.reason || ""), idempotency_key: String(body.idempotency_key || crypto.randomUUID()), requested_by: c.userId }).select("*").single(); if (error) throw error;
      await audit(c.admin, c.organizationId, "marketplace_cancellation_requested", c.userId, { saga_id: data.id, order_link_id: link.id }); return NextResponse.json({ ok: true, cancellation: data, message: "Cancelamento solicitado; o pedido só será cancelado após confirmação do provedor." });
    }
    if (action === "reconcile_payout") {
      const result = reconcileMarketplacePayout(Number(body.expected_cents), Number(body.paid_cents), Number(body.tolerance_cents || 0));
      const { error } = await c.admin.from("marketplace_payouts").update({ paid_cents: Number(body.paid_cents), status: result.status === "matched" ? "reconciled" : "divergent", reconciliation_reference: String(body.reference || "manual") }).eq("id", body.payout_id).eq("organization_id", c.organizationId); if (error) throw error;
      await audit(c.admin, c.organizationId, "marketplace_payout_reconciled", c.userId, { payout_id: body.payout_id, ...result }); return NextResponse.json({ ok: true, ...result });
    }
    throw new Error("Ação inválida.");
  } catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Falha na operação." }, { status: 400 }); }
}
