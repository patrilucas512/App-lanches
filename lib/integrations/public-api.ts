import { createHash } from "node:crypto";
import type { ApiContext } from "@/lib/integrations/auth";
import { PublicApiError, assertStoreAccess } from "@/lib/integrations/auth";
import { cursorDecode, cursorEncode } from "@/lib/integrations/security";

type Body = Record<string, any>;
const orderStatuses = new Set(["new", "confirmed", "preparing", "ready", "out_for_delivery", "completed", "canceled"]);
const reservationActions: Record<string, string> = { confirmed: "confirm", cancelled: "cancel", canceled: "cancel", seated: "seat", completed: "complete", no_show: "no_show" };

export async function resolveStores(context: ApiContext, requested?: string | null) {
  if (requested) { await assertStoreAccess(context, requested); return [requested]; }
  if (!context.allStores) return context.storeIds;
  const { data } = await context.admin.from("establishments").select("id").eq("organization_id", context.organizationId).eq("active", true);
  return (data || []).map((item: { id: string }) => item.id);
}

export function pagination(url: URL) {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 100);
  return { limit, cursor: cursorDecode(url.searchParams.get("cursor")) };
}

export async function listResource(context: ApiContext, resource: "orders" | "products" | "customers" | "inventory" | "reservations", url: URL) {
  if (context.environment === "sandbox") return { data: [], has_more: false, next_cursor: null, sandbox: true };
  const storeIds = await resolveStores(context, url.searchParams.get("store_id"));
  const { limit, cursor } = pagination(url);
  if (!storeIds.length) return { data: [], has_more: false, next_cursor: null };
  const table = resource === "inventory" ? "inventory_items" : resource;
  const storeColumn = resource === "inventory" || resource === "reservations" ? "establishment_id" : "establishment_id";
  const selects: Record<string, string> = {
    orders: "id,store_id,establishment_id,order_number,status,fulfillment_type,customer_name,total_cents,payment_method,source,created_at,updated_at",
    products: "id,establishment_id,category_id,name,description,image_url,price_cents,active,created_at,updated_at",
    customers: "id,establishment_id,name,phone,last_order_at,total_orders,total_spent_cents,created_at,updated_at",
    inventory: "id,establishment_id,sku,name,unit,balance,minimum,needs_restock,active,updated_at",
    reservations: "id,organization_id,establishment_id,reservation_code,starts_at,ends_at,party_size,status,source,customer_name,created_at,updated_at",
  };
  let query: any = context.admin.from(table).select(selects[resource]).in(storeColumn, storeIds).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
  const status = url.searchParams.get("status"); if (status && ["orders", "reservations"].includes(resource)) query = query.eq("status", status);
  const updated = url.searchParams.get("updated_since"); if (updated) query = query.gte("updated_at", updated);
  const from = url.searchParams.get("date_from"); if (from) query = query.gte("created_at", from);
  const to = url.searchParams.get("date_to"); if (to) query = query.lte("created_at", to);
  if (cursor) query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
  const { data, error } = await query; if (error) throw new PublicApiError(400, "query_failed", error.message);
  const rows = data || []; const hasMore = rows.length > limit; const page = rows.slice(0, limit); const last = page.at(-1);
  return { data: page, has_more: hasMore, next_cursor: hasMore && last?.created_at ? cursorEncode({ created_at: last.created_at, id: last.id }) : null };
}

export async function getResource(context: ApiContext, resource: "orders" | "products" | "customers" | "inventory" | "reservations", id: string) {
  if (context.environment === "sandbox") throw new PublicApiError(404, "sandbox_not_found", "O recurso não existe no ambiente sandbox.");
  const table = resource === "inventory" ? "inventory_items" : resource;
  const select = resource === "customers" ? "id,establishment_id,name,phone,last_order_at,total_orders,total_spent_cents,created_at,updated_at" : "*";
  const { data, error } = await context.admin.from(table).select(select).eq("id", id).maybeSingle();
  if (error || !data) throw new PublicApiError(404, "not_found", "Registro não encontrado.");
  await assertStoreAccess(context, data.establishment_id || data.store_id);
  if (resource === "orders") {
    const { data: items } = await context.admin.from("order_items").select("id,product_id,product_name,quantity,unit_price_cents,addons,total_cents").eq("order_id", id);
    return { ...data, items: items || [] };
  }
  return data;
}

export async function createOrder(context: ApiContext, body: Body) {
  const storeId = String(body.store_id || ""); await assertStoreAccess(context, storeId);
  const { data, error } = await context.admin.rpc("integration_create_order", { requested_store_id: storeId, requested_payload: body, requested_origin: body.provider ? "marketplace" : "custom_api", requested_correlation_id: context.requestId, requested_environment: context.environment });
  if (error) throw new PublicApiError(422, "order_rejected", error.message); return data;
}

export async function updateOrderStatus(context: ApiContext, id: string, body: Body) {
  const status = String(body.status || "");
  if (!orderStatuses.has(status)) throw new PublicApiError(422, "invalid_status", "Status de pedido inválido.");
  if (context.environment === "sandbox") return { id, status, sandbox: true };
  const order = await getResource(context, "orders", id) as any;
  const allowed: Record<string, string[]> = { new: ["confirmed", "canceled"], confirmed: ["preparing", "canceled"], preparing: ["ready", "canceled"], ready: ["out_for_delivery", "completed", "canceled"], out_for_delivery: ["completed", "canceled"] };
  if (!allowed[order.status]?.includes(status)) throw new PublicApiError(409, "invalid_transition", `Transição ${order.status} → ${status} não permitida.`);
  const { data, error } = await context.admin.from("orders").update({ status }).eq("id", id).eq("establishment_id", order.establishment_id).select("id,status,updated_at").single();
  if (error) throw new PublicApiError(422, "status_rejected", error.message);
  await context.admin.rpc("enqueue_integration_event", { requested_organization_id: context.organizationId, requested_store_id: order.establishment_id, requested_type: status === "canceled" ? "order.cancelled" : "order.updated", requested_aggregate_type: "order", requested_aggregate_id: id, requested_payload: { order_id: id, order_number: order.order_number, status, store_id: order.establishment_id }, requested_origin: "custom_api", requested_correlation_id: context.requestId, requested_environment: context.environment });
  return data;
}

export async function updateAvailability(context: ApiContext, id: string, body: Body) {
  if (typeof body.available !== "boolean") throw new PublicApiError(422, "invalid_payload", "Informe available como booleano.");
  if (context.environment === "sandbox") return { id, available: body.available, sandbox: true };
  const product = await getResource(context, "products", id) as any;
  const { data, error } = await context.admin.from("products").update({ active: body.available }).eq("id", id).eq("establishment_id", product.establishment_id).select("id,active,updated_at").single();
  if (error) throw new PublicApiError(422, "availability_rejected", error.message); return { ...data, available: data.active };
}

export async function createReservation(context: ApiContext, body: Body, idempotencyKey: string) {
  const storeId = String(body.store_id || ""); await assertStoreAccess(context, storeId);
  if (context.environment === "sandbox") return { id: "00000000-0000-0000-0000-000000000000", reservation_code: "SANDBOX", sandbox: true };
  const { data, error } = await context.admin.rpc("create_reservation", { requested_establishment_id: storeId, requested_customer_id: body.customer_id || null, requested_start: body.starts_at, requested_party_size: body.party_size, requested_duration_minutes: body.duration_minutes || null, requested_source: "manual", requested_customer_name: body.customer_name, requested_customer_phone: body.customer_phone, requested_notes: body.notes || null, requested_table_ids: body.table_ids || [], requested_idempotency_key: idempotencyKey });
  if (error) throw new PublicApiError(422, "reservation_rejected", error.message); return data;
}

export async function updateReservation(context: ApiContext, id: string, body: Body) {
  const target = String(body.status || ""); const action = reservationActions[target];
  if (!action) throw new PublicApiError(422, "invalid_status", "Status de reserva inválido.");
  if (context.environment === "sandbox") return { id, status: target, sandbox: true };
  const reservation = await getResource(context, "reservations", id) as any;
  const { data, error } = await context.admin.rpc("reservation_action", { requested_establishment_id: reservation.establishment_id, requested_reservation_id: id, requested_action: action, requested_payload: body });
  if (error) throw new PublicApiError(422, "reservation_rejected", error.message); return data;
}

export async function financeSummary(context: ApiContext, url: URL) {
  if (context.environment === "sandbox") return { currency: "BRL", approved_revenue_cents: 0, approved_orders: 0, cancelled_orders: 0, total_orders: 0, sandbox: true };
  const stores = await resolveStores(context, url.searchParams.get("store_id"));
  let query = context.admin.from("orders").select("total_cents,status,online_payment_status,created_at").in("establishment_id", stores);
  const from = url.searchParams.get("date_from"); const to = url.searchParams.get("date_to"); if (from) query = query.gte("created_at", from); if (to) query = query.lte("created_at", to);
  const { data, error } = await query.limit(10000); if (error) throw new PublicApiError(400, "query_failed", error.message);
  const rows = (data || []) as Array<{total_cents:number;status:string;online_payment_status?:string}>; const approved = rows.filter((item) => item.status === "completed" || item.online_payment_status === "approved"); const cancelled = rows.filter((item) => item.status === "canceled");
  return { currency: "BRL", approved_revenue_cents: approved.reduce((sum:number, item) => sum + item.total_cents, 0), approved_orders: approved.length, cancelled_orders: cancelled.length, total_orders: rows.length };
}

export function bodyHash(body: unknown) { return createHash("sha256").update(JSON.stringify(body ?? {})).digest("hex"); }

