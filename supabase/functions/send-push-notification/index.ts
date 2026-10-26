import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const VAPID_PUBLIC_KEY = "BCP0CejQDRaVxSo35ZtUDs5wFYbrTNnAJZDrlFBaI1hzPONZR89meKlAFlVOFXHu7TDUZFT-n_CAy0K1kUuCobQ";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deliveryEvents = ["new_delivery_offer", "driver_assigned", "picked_up", "on_route", "driver_arrived", "delivered", "delivery_incident", "delivery_delay_alert"] as const;
type Audience = "customer" | "kitchen" | "waiter" | "driver" | "operations";
type Subscription = { id: string; endpoint: string; p256dh: string; auth_key: string };
type PushMessage = { subscriptions: Subscription[]; title: string; body: string; url: string; tag: string; ttl?: number };

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const { data: expectedSecret } = await supabase.rpc("get_push_webhook_secret");
    const suppliedSecret = request.headers.get("x-webhook-secret") || "";
    const [expectedHash, suppliedHash] = await Promise.all([expectedSecret, suppliedSecret].map(value => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value || ""))));
    const expectedBytes = new Uint8Array(expectedHash); const suppliedBytes = new Uint8Array(suppliedHash);
    let secretMismatch = expectedBytes.length !== suppliedBytes.length;
    for (let index = 0; index < expectedBytes.length; index += 1) secretMismatch ||= expectedBytes[index] !== suppliedBytes[index];
    if (!expectedSecret || secretMismatch) return new Response("Unauthorized", { status: 401 });

    const payload = await request.json();
    const messages = payload.delivery_id
      ? await buildDeliveryMessages(supabase, payload)
      : await buildKitchenMessages(supabase, payload);
    if (messages.duplicate) return Response.json({ ok: true, duplicate: true });

    const { data: privateKey, error: keyError } = await supabase.rpc("get_push_private_key");
    if (keyError || !privateKey) throw keyError || new Error("Missing VAPID key");
    webpush.setVapidDetails("mailto:patricklucas512@gmail.com", VAPID_PUBLIC_KEY, privateKey);

    const sentEndpoints = new Set<string>();
    let sent = 0;
    for (const message of messages.items) {
      await Promise.all(message.subscriptions.map(async subscription => {
        if (sentEndpoints.has(subscription.endpoint)) return;
        sentEndpoints.add(subscription.endpoint);
        try {
          await webpush.sendNotification(
            { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth_key } },
            JSON.stringify({ title: message.title, body: message.body, url: message.url, tag: message.tag }),
            { TTL: message.ttl || 3600, urgency: "high" },
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

async function subscriptions(supabase: ReturnType<typeof createClient>, establishmentId: string, audience: Audience, options: { orderId?: string; driverId?: string } = {}) {
  let query = supabase.from("push_subscriptions").select("id,endpoint,p256dh,auth_key")
    .eq("establishment_id", establishmentId).eq("audience", audience).gt("expires_at", new Date().toISOString());
  if (options.orderId) query = query.eq("order_id", options.orderId);
  if (options.driverId) query = query.eq("driver_profile_id", options.driverId);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as Subscription[];
}

async function buildDeliveryMessages(supabase: ReturnType<typeof createClient>, payload: Record<string, unknown>) {
  const deliveryId = String(payload.delivery_id || "");
  const event = String(payload.event || "") as typeof deliveryEvents[number];
  const assignmentId = payload.assignment_id ? String(payload.assignment_id) : null;
  const incidentId = payload.incident_id ? String(payload.incident_id) : null;
  const alertId = payload.alert_id ? String(payload.alert_id) : null;
  if (!uuidPattern.test(deliveryId) || !deliveryEvents.includes(event)) throw new Error("Invalid delivery event");
  if (assignmentId && !uuidPattern.test(assignmentId)) throw new Error("Invalid assignment");
  if (incidentId && !uuidPattern.test(incidentId)) throw new Error("Invalid incident");
  if (alertId && !uuidPattern.test(alertId)) throw new Error("Invalid alert");

  const { data: delivery, error } = await supabase.from("deliveries")
    .select("id,establishment_id,order_id,status,orders(order_number,customer_name)").eq("id", deliveryId).single();
  if (error || !delivery) throw error || new Error("Delivery not found");
  const order = Array.isArray(delivery.orders) ? delivery.orders[0] : delivery.orders;
  let driverId: string | null = null;
  if (assignmentId) {
    const { data: assignment } = await supabase.from("delivery_assignments")
      .select("id,status,driver_profile_id").eq("id", assignmentId).eq("delivery_id", deliveryId).maybeSingle();
    if (!assignment) throw new Error("Assignment not found");
    if (event === "new_delivery_offer" && assignment.status !== "offered") return { duplicate: true, items: [] as PushMessage[] };
    if (event === "driver_assigned" && assignment.status !== "accepted") return { duplicate: true, items: [] as PushMessage[] };
    driverId = assignment.driver_profile_id;
  }
  if (event === "delivery_incident") {
    const { data: incident } = await supabase.from("delivery_incidents").select("id,driver_profile_id").eq("id", incidentId).eq("delivery_id", deliveryId).maybeSingle();
    if (!incident) throw new Error("Incident not found");
    driverId ||= incident.driver_profile_id;
  }
  let operationalAlert: { title: string; message: string } | null = null;
  if (event === "delivery_delay_alert") {
    if (!alertId) throw new Error("Missing alert");
    const { data: alert } = await supabase.from("delivery_operational_alerts")
      .select("id,title,message,resolved_at").eq("id", alertId).eq("delivery_id", deliveryId).maybeSingle();
    if (!alert || alert.resolved_at) return { duplicate: true, items: [] as PushMessage[] };
    operationalAlert = { title: alert.title, message: alert.message };
  }

  const { error: eventError } = await supabase.from("delivery_push_notification_events").insert({
    establishment_id: delivery.establishment_id, delivery_id: deliveryId, assignment_id: assignmentId, incident_id: incidentId, alert_id: alertId, event_name: event,
  });
  if (eventError?.code === "23505") return { duplicate: true, items: [] as PushMessage[] };
  if (eventError) throw eventError;

  const { data: establishment } = await supabase.from("establishments").select("slug").eq("id", delivery.establishment_id).single();
  const orderNumber = order?.order_number || "—";
  const customerName = order?.customer_name || "Cliente";
  const customer = () => subscriptions(supabase, delivery.establishment_id, "customer", { orderId: delivery.order_id });
  const operations = () => subscriptions(supabase, delivery.establishment_id, "operations");
  const items: PushMessage[] = [];
  const customerUrl = `/loja/${establishment?.slug || "app-lanches"}`;
  const operationsUrl = "/painel/pedidos#despacho-entregas";

  if (event === "new_delivery_offer" && driverId) items.push({
    subscriptions: await subscriptions(supabase, delivery.establishment_id, "driver", { driverId }),
    title: "Nova entrega disponível", body: `Pedido #${orderNumber} aguarda sua resposta.`, url: "/motoboy", tag: `masterapp-offer-${assignmentId}`, ttl: 90,
  });
  if (event === "driver_assigned") {
    items.push({ subscriptions: await customer(), title: `Motoboy confirmado · Pedido #${orderNumber}`, body: `${customerName}, sua entrega já tem um responsável.`, url: customerUrl, tag: `masterapp-driver-${deliveryId}`, ttl: 86400 });
    items.push({ subscriptions: await operations(), title: `Entrega #${orderNumber} aceita`, body: "O motoboy assumiu a entrega.", url: operationsUrl, tag: `masterapp-assigned-${deliveryId}` });
  }
  if (event === "picked_up") items.push({ subscriptions: await customer(), title: `Pedido #${orderNumber} retirado`, body: "O motoboy retirou seu pedido no estabelecimento.", url: customerUrl, tag: `masterapp-picked-${deliveryId}`, ttl: 86400 });
  if (event === "on_route") items.push({ subscriptions: await customer(), title: "Seu pedido está a caminho", body: `Pedido #${orderNumber} saiu para entrega.`, url: customerUrl, tag: `masterapp-route-${deliveryId}`, ttl: 86400 });
  if (event === "driver_arrived") items.push({ subscriptions: await customer(), title: "Seu pedido chegou!", body: "O entregador está no endereço. Separe o PIN de confirmação.", url: customerUrl, tag: `masterapp-arrived-${deliveryId}`, ttl: 1800 });
  if (event === "delivered") items.push({ subscriptions: await customer(), title: `Pedido #${orderNumber} entregue`, body: "Entrega concluída. Obrigado pelo pedido!", url: customerUrl, tag: `masterapp-delivered-${deliveryId}`, ttl: 86400 });
  if (event === "delivery_incident") items.push({ subscriptions: await operations(), title: `Atenção na entrega #${orderNumber}`, body: "O motoboy registrou uma ocorrência. Abra a Central de Entregas.", url: operationsUrl, tag: `masterapp-incident-${incidentId}`, ttl: 86400 });
  if (event === "delivery_delay_alert" && operationalAlert) items.push({ subscriptions: await operations(), title: operationalAlert.title, body: operationalAlert.message, url: operationsUrl, tag: `masterapp-delay-${alertId}`, ttl: 3600 });
  return { duplicate: false, items };
}

async function buildKitchenMessages(supabase: ReturnType<typeof createClient>, payload: Record<string, unknown>) {
  const ticketId = String(payload.ticket_id || "");
  const event = String(payload.event || "");
  if (!uuidPattern.test(ticketId) || !["new_order", "ready"].includes(event)) throw new Error("Invalid kitchen event");
  const { data: ticket, error } = await supabase.from("kitchen_tickets")
    .select("id,establishment_id,table_order_id,public_order_id,status,created_at").eq("id", ticketId).single();
  if (error || !ticket) throw error || new Error("Ticket not found");
  if (event === "ready" && ticket.status !== "ready") return { duplicate: true, items: [] as PushMessage[] };
  if (event === "new_order" && Date.now() - new Date(ticket.created_at).getTime() > 10 * 60_000) return { duplicate: true, items: [] as PushMessage[] };
  const { error: eventError } = await supabase.from("push_notification_events").insert({ ticket_id: ticketId, event_name: event });
  if (eventError?.code === "23505") return { duplicate: true, items: [] as PushMessage[] };
  if (eventError) throw eventError;

  const [{ data: serviceMode }, { data: establishment }] = await Promise.all([
    supabase.from("service_modes").select("waiter_mode_enabled").eq("establishment_id", ticket.establishment_id).single(),
    supabase.from("establishments").select("slug").eq("id", ticket.establishment_id).single(),
  ]);
  let orderNumber = ""; let customerName = ""; let fulfillmentType = ""; let tableId = "";
  if (ticket.public_order_id) {
    const { data: order } = await supabase.from("orders").select("order_number,customer_name,fulfillment_type,restaurant_table_id").eq("id", ticket.public_order_id).single();
    orderNumber = String(order?.order_number || ""); customerName = order?.customer_name || "Cliente"; fulfillmentType = order?.fulfillment_type || ""; tableId = order?.restaurant_table_id || "";
  } else if (ticket.table_order_id) {
    const { data: tableOrder } = await supabase.from("table_orders").select("order_number,table_session_id").eq("id", ticket.table_order_id).single();
    orderNumber = String(tableOrder?.order_number || "");
    if (tableOrder?.table_session_id) {
      const { data: session } = await supabase.from("table_sessions").select("table_id,customer_name").eq("id", tableOrder.table_session_id).single();
      tableId = session?.table_id || ""; customerName = session?.customer_name || "Cliente";
    }
    fulfillmentType = "dine_in";
  }
  let tableNumber = "";
  if (tableId) {
    const { data: table } = await supabase.from("restaurant_tables").select("table_number").eq("id", tableId).single();
    tableNumber = table?.table_number || "";
  }
  const items: PushMessage[] = [];
  const waiterRelevant = Boolean(serviceMode?.waiter_mode_enabled) && fulfillmentType === "dine_in";
  if (event === "new_order") {
    items.push({ subscriptions: await subscriptions(supabase, ticket.establishment_id, "kitchen"), title: "Novo pedido na cozinha", body: "Uma nova comanda chegou. Toque para abrir a cozinha.", url: "/cozinha", tag: `masterapp-new-${ticketId}`, ttl: 300 });
    if (waiterRelevant) items.push({ subscriptions: await subscriptions(supabase, ticket.establishment_id, "waiter"), title: `Novo pedido${tableNumber ? ` · Mesa ${tableNumber}` : " do salão"}`, body: `Pedido #${orderNumber || "—"} recebido e enviado para a cozinha.`, url: "/painel/garcom", tag: `masterapp-waiter-new-${ticketId}`, ttl: 300 });
  } else {
    if (ticket.public_order_id) items.push({ subscriptions: await subscriptions(supabase, ticket.establishment_id, "customer", { orderId: ticket.public_order_id }), title: `Pedido #${orderNumber} pronto!`, body: waiterRelevant ? `${customerName}, a equipe levará até ${tableNumber ? `a mesa ${tableNumber}` : "sua mesa"}.` : `${customerName}, retirar seu pedido no balcão, obrigado.`, url: `/loja/${establishment?.slug || "app-lanches"}`, tag: `masterapp-ready-${ticketId}`, ttl: 86400 });
    if (waiterRelevant) items.push({ subscriptions: await subscriptions(supabase, ticket.establishment_id, "waiter"), title: `Pedido #${orderNumber || "—"} pronto!`, body: `${tableNumber ? `Mesa ${tableNumber}` : "Pedido do salão"} · retirar agora na cozinha.`, url: "/painel/garcom", tag: `masterapp-waiter-ready-${ticketId}`, ttl: 86400 });
  }
  return { duplicate: false, items };
}
