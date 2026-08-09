import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const VAPID_PUBLIC_KEY = "BCP0CejQDRaVxSo35ZtUDs5wFYbrTNnAJZDrlFBaI1hzPONZR89meKlAFlVOFXHu7TDUZFT-n_CAy0K1kUuCobQ";
type Subscription = { id: string; endpoint: string; p256dh: string; auth_key: string };
type Delivery = { subscriptions: Subscription[]; title: string; body: string; url: string };

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: expectedSecret } = await supabase.rpc("get_push_webhook_secret");
    const suppliedSecret = request.headers.get("x-webhook-secret") || "";
    const [expectedHash, suppliedHash] = await Promise.all([expectedSecret, suppliedSecret].map(value => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value || ""))));
    const expectedBytes = new Uint8Array(expectedHash); const suppliedBytes = new Uint8Array(suppliedHash);
    let secretMismatch = expectedBytes.length !== suppliedBytes.length;
    for (let index = 0; index < expectedBytes.length; index += 1) secretMismatch ||= expectedBytes[index] !== suppliedBytes[index];
    if (!expectedSecret || secretMismatch) return new Response("Unauthorized", { status: 401 });

    const { ticket_id, event } = await request.json();
    if (!/^[0-9a-f-]{36}$/i.test(String(ticket_id)) || !["new_order", "ready"].includes(event)) return new Response("Invalid event", { status: 400 });
    const { data: ticket, error: ticketError } = await supabase.from("kitchen_tickets")
      .select("id,establishment_id,table_order_id,public_order_id,status,created_at").eq("id", ticket_id).single();
    if (ticketError || !ticket) return new Response("Not found", { status: 404 });
    if (event === "ready" && ticket.status !== "ready") return new Response("Stale event", { status: 409 });
    if (event === "new_order" && Date.now() - new Date(ticket.created_at).getTime() > 10 * 60_000) return new Response("Expired event", { status: 410 });

    const { error: eventError } = await supabase.from("push_notification_events").insert({ ticket_id, event_name: event });
    if (eventError?.code === "23505") return Response.json({ ok: true, duplicate: true });
    if (eventError) throw eventError;

    const [{ data: privateKey, error: keyError }, { data: serviceMode }, { data: establishment }] = await Promise.all([
      supabase.rpc("get_push_private_key"),
      supabase.from("service_modes").select("waiter_mode_enabled").eq("establishment_id", ticket.establishment_id).single(),
      supabase.from("establishments").select("slug").eq("id", ticket.establishment_id).single(),
    ]);
    if (keyError || !privateKey) throw keyError || new Error("Missing VAPID key");

    let orderNumber = "";
    let customerName = "";
    let fulfillmentType = "";
    let tableId = "";
    if (ticket.public_order_id) {
      const { data: order } = await supabase.from("orders")
        .select("order_number,customer_name,fulfillment_type,restaurant_table_id").eq("id", ticket.public_order_id).single();
      orderNumber = String(order?.order_number || "");
      customerName = order?.customer_name || "Cliente";
      fulfillmentType = order?.fulfillment_type || "";
      tableId = order?.restaurant_table_id || "";
    } else if (ticket.table_order_id) {
      const { data: tableOrder } = await supabase.from("table_orders").select("order_number,table_session_id").eq("id", ticket.table_order_id).single();
      orderNumber = String(tableOrder?.order_number || "");
      if (tableOrder?.table_session_id) {
        const { data: session } = await supabase.from("table_sessions").select("table_id,customer_name").eq("id", tableOrder.table_session_id).single();
        tableId = session?.table_id || "";
        customerName = session?.customer_name || "Cliente";
      }
      fulfillmentType = "dine_in";
    }
    let tableNumber = "";
    if (tableId) {
      const { data: table } = await supabase.from("restaurant_tables").select("table_number").eq("id", tableId).single();
      tableNumber = table?.table_number || "";
    }

    async function subscriptions(audience: "customer" | "kitchen" | "waiter", orderId?: string) {
      let query = supabase.from("push_subscriptions").select("id,endpoint,p256dh,auth_key")
        .eq("establishment_id", ticket.establishment_id).eq("audience", audience).gt("expires_at", new Date().toISOString());
      if (orderId) query = query.eq("order_id", orderId);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as Subscription[];
    }

    const deliveries: Delivery[] = [];
    const waiterRelevant = Boolean(serviceMode?.waiter_mode_enabled) && fulfillmentType === "dine_in";
    if (event === "new_order") {
      deliveries.push({
        subscriptions: await subscriptions("kitchen"),
        title: "Novo pedido na cozinha",
        body: "Uma nova comanda chegou. Toque para abrir a cozinha.",
        url: "/cozinha",
      });
      if (waiterRelevant) deliveries.push({
        subscriptions: await subscriptions("waiter"),
        title: `Novo pedido${tableNumber ? ` · Mesa ${tableNumber}` : " do salão"}`,
        body: `Pedido #${orderNumber || "—"} recebido e enviado para a cozinha.`,
        url: "/painel/garcom",
      });
    } else {
      if (ticket.public_order_id) deliveries.push({
        subscriptions: await subscriptions("customer", ticket.public_order_id),
        title: `Pedido #${orderNumber} pronto!`,
        body: waiterRelevant
          ? `${customerName}, a equipe levará até ${tableNumber ? `a mesa ${tableNumber}` : "sua mesa"}.`
          : `${customerName}, retirar seu pedido no balcão, obrigado.`,
        url: `/loja/${establishment?.slug || "app-lanches"}`,
      });
      if (waiterRelevant) deliveries.push({
        subscriptions: await subscriptions("waiter"),
        title: `Pedido #${orderNumber || "—"} pronto!`,
        body: `${tableNumber ? `Mesa ${tableNumber}` : "Pedido do salão"} · retirar agora na cozinha.`,
        url: "/painel/garcom",
      });
    }

    webpush.setVapidDetails("mailto:patricklucas512@gmail.com", VAPID_PUBLIC_KEY, privateKey);
    const sentEndpoints = new Set<string>();
    let sent = 0;
    for (const delivery of deliveries) {
      await Promise.all(delivery.subscriptions.map(async subscription => {
        if (sentEndpoints.has(subscription.endpoint)) return;
        sentEndpoints.add(subscription.endpoint);
        try {
          await webpush.sendNotification(
            { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth_key } },
            JSON.stringify({ title: delivery.title, body: delivery.body, url: delivery.url, tag: `mesa-viva-${event}-${ticket.id}` }),
            { TTL: event === "ready" ? 86400 : 300, urgency: "high" },
          );
          sent += 1;
        } catch (error) {
          const status = Number((error as { statusCode?: number }).statusCode || 0);
          if (status === 404 || status === 410) await supabase.from("push_subscriptions").delete().eq("id", subscription.id);
          else console.error("Push delivery failed", status);
        }
      }));
    }
    return Response.json({ ok: true, sent });
  } catch (error) {
    console.error(error);
    return new Response("Notification failed", { status: 500 });
  }
});
