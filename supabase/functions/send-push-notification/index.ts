import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const VAPID_PUBLIC_KEY = "BCP0CejQDRaVxSo35ZtUDs5wFYbrTNnAJZDrlFBaI1hzPONZR89meKlAFlVOFXHu7TDUZFT-n_CAy0K1kUuCobQ";

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
    const { data: ticket, error: ticketError } = await supabase.from("kitchen_tickets").select("id,establishment_id,public_order_id,status,created_at").eq("id", ticket_id).single();
    if (ticketError || !ticket) return new Response("Not found", { status: 404 });
    if (event === "ready" && ticket.status !== "ready") return new Response("Stale event", { status: 409 });
    if (event === "new_order" && Date.now() - new Date(ticket.created_at).getTime() > 10 * 60_000) return new Response("Expired event", { status: 410 });
    const { error: eventError } = await supabase.from("push_notification_events").insert({ ticket_id, event_name: event });
    if (eventError?.code === "23505") return Response.json({ ok: true, duplicate: true });
    if (eventError) throw eventError;

    let title = "Novo pedido na cozinha";
    let body = "Uma nova comanda chegou. Toque para abrir a cozinha.";
    let url = "/cozinha";
    let subscriptionsQuery = supabase.from("push_subscriptions").select("id,endpoint,p256dh,auth_key").eq("establishment_id", ticket.establishment_id).eq("audience", "kitchen").gt("expires_at", new Date().toISOString());
    if (event === "ready") {
      if (!ticket.public_order_id) return Response.json({ ok: true, sent: 0 });
      const [{ data: order }, { data: serviceMode }, { data: establishment }] = await Promise.all([
        supabase.from("orders").select("order_number,customer_name,fulfillment_type,restaurant_table_id").eq("id", ticket.public_order_id).single(),
        supabase.from("service_modes").select("waiter_mode_enabled").eq("establishment_id", ticket.establishment_id).single(),
        supabase.from("establishments").select("slug").eq("id", ticket.establishment_id).single(),
      ]);
      let tableNumber = "";
      if (order?.restaurant_table_id) {
        const { data: table } = await supabase.from("restaurant_tables").select("table_number").eq("id", order.restaurant_table_id).single();
        tableNumber = table?.table_number || "";
      }
      title = `Pedido #${order?.order_number || ""} pronto!`;
      body = order?.fulfillment_type === "dine_in" && serviceMode?.waiter_mode_enabled
        ? `${order?.customer_name || "Seu pedido"}, a equipe levará até ${tableNumber ? `a mesa ${tableNumber}` : "sua mesa"}.`
        : `${order?.customer_name || "Seu pedido"}, retirar seu pedido no balcão, obrigado.`;
      url = `/loja/${establishment?.slug || "app-lanches"}`;
      subscriptionsQuery = supabase.from("push_subscriptions").select("id,endpoint,p256dh,auth_key").eq("order_id", ticket.public_order_id).eq("audience", "customer").gt("expires_at", new Date().toISOString());
    }
    const [{ data: subscriptions, error: subscriptionsError }, { data: privateKey, error: keyError }] = await Promise.all([subscriptionsQuery, supabase.rpc("get_push_private_key")]);
    if (subscriptionsError || keyError || !privateKey) throw subscriptionsError || keyError || new Error("Missing VAPID key");
    webpush.setVapidDetails("mailto:patricklucas512@gmail.com", VAPID_PUBLIC_KEY, privateKey);
    let sent = 0;
    await Promise.all((subscriptions || []).map(async subscription => {
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth_key } }, JSON.stringify({ title, body, url, tag: `mesa-viva-${event}-${ticket.id}` }), { TTL: event === "ready" ? 86400 : 300, urgency: "high" });
        sent += 1;
      } catch (error) {
        const status = Number((error as { statusCode?: number }).statusCode || 0);
        if (status === 404 || status === 410) await supabase.from("push_subscriptions").delete().eq("id", subscription.id);
        else console.error("Push delivery failed", status);
      }
    }));
    return Response.json({ ok: true, sent });
  } catch (error) {
    console.error(error);
    return new Response("Notification failed", { status: 500 });
  }
});
