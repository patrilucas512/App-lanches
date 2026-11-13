import type { SupabaseClient } from "@supabase/supabase-js";

// The board shows open tickets plus the ones delivered today (São Paulo), so a 30h window
// for delivered tickets is enough. Reading the whole history hit the API row cap
// (1000 rows) after a few busy days and the newest tickets silently disappeared.
const DELIVERED_WINDOW_MS = 30 * 60 * 60 * 1000;
const TICKET_LIMIT = 500;
const ID_CHUNK = 150;

type Row = Record<string, unknown>;

async function inChunks(ids: string[], load: (chunk: string[]) => PromiseLike<{ data: Row[] | null; error: unknown }>) {
  const unique = [...new Set(ids)];
  const rows: Row[] = [];
  for (let start = 0; start < unique.length; start += ID_CHUNK) {
    const { data, error } = await load(unique.slice(start, start + ID_CHUNK));
    if (error) return null;
    rows.push(...(data || []));
  }
  return rows;
}

export async function loadKitchenBoardData(supabase: SupabaseClient, establishmentId: string) {
  const deliveredSince = new Date(Date.now() - DELIVERED_WINDOW_MS).toISOString();
  const { data: recent, error } = await supabase.from("kitchen_tickets").select("*")
    .eq("establishment_id", establishmentId).neq("status", "canceled")
    .or(`status.neq.delivered,delivered_at.gte.${deliveredSince}`)
    .order("created_at", { ascending: false }).limit(TICKET_LIMIT);
  if (error || !recent) return null;
  const tickets = [...recent].reverse();
  const publicIds = tickets.map(ticket => ticket.public_order_id).filter(Boolean) as string[];
  const tableOrderIds = tickets.map(ticket => ticket.table_order_id).filter(Boolean) as string[];

  const [tableOrders, publicOrders, deliveries, deliveryDestinations, tableItems, publicItems, { data: tables }] = await Promise.all([
    inChunks(tableOrderIds, chunk => supabase.from("table_orders").select("id,table_session_id,order_number,notes").eq("establishment_id", establishmentId).in("id", chunk)),
    inChunks(publicIds, chunk => supabase.from("orders").select("id,order_number,notes,customer_name,fulfillment_type,restaurant_table_id,payment_method,total_cents,cash_received_cents,cash_change_cents").eq("establishment_id", establishmentId).in("id", chunk)),
    inChunks(publicIds, chunk => supabase.from("deliveries").select("id,order_id,status,ready_at").eq("establishment_id", establishmentId).in("order_id", chunk)),
    inChunks(publicIds, chunk => supabase.from("delivery_destinations").select("delivery_order_id,recipient_name,recipient_phone,postal_code,street,street_number,complement,neighborhood,city,state,reference").eq("establishment_id", establishmentId).in("delivery_order_id", chunk)),
    inChunks(tableOrderIds, chunk => supabase.from("table_order_items").select("id,table_order_id,product_name,quantity,notes,addons,removed_ingredients").eq("establishment_id", establishmentId).in("table_order_id", chunk)),
    inChunks(publicIds, chunk => supabase.from("order_items").select("id,order_id,product_name,quantity,notes,addons,removed_ingredients").eq("establishment_id", establishmentId).in("order_id", chunk)),
    supabase.from("restaurant_tables").select("id,table_number,table_name").eq("establishment_id", establishmentId),
  ]);
  if (!tableOrders || !publicOrders || !deliveries || !deliveryDestinations || !tableItems || !publicItems || !tables) return null;
  const sessions = await inChunks(tableOrders.map(order => String(order.table_session_id)), chunk => supabase.from("table_sessions").select("id,table_id,customer_name").eq("establishment_id", establishmentId).in("id", chunk));
  if (!sessions) return null;
  return { tickets, tableOrders, publicOrders, deliveries, deliveryDestinations, sessions, tables, tableItems, publicItems };
}
