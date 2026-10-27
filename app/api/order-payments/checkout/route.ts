import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createHostedCheckout, type GatewayEnvironment, type GatewayProvider } from "@/lib/order-payments/providers";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { order_id?: string; tracking_token?: string; provider?: GatewayProvider };
    if (!body.order_id || !body.tracking_token || !["mercado_pago", "pagarme"].includes(String(body.provider)))
      return NextResponse.json({ error: "Dados do pagamento incompletos." }, { status: 400 });
    const admin = createAdminClient();
    const { data: order } = await admin.from("orders")
      .select("id,order_number,total_cents,customer_name,tracking_token,establishment_id,online_payment_status,payment_method,status")
      .eq("id", body.order_id).eq("tracking_token", body.tracking_token).maybeSingle();
    if (!order) return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });
    if (order.payment_method !== `${body.provider}_online` || order.online_payment_status !== "pending" || ["canceled", "cancelled"].includes(order.status))
      return NextResponse.json({ error: "Este pedido não aceita uma nova cobrança." }, { status: 409 });
    const { data: establishment } = await admin.from("establishments").select("slug").eq("id", order.establishment_id).single();
    if (!establishment) return NextResponse.json({ error: "Estabelecimento não encontrado." }, { status: 404 });
    if (order.online_payment_status === "approved") return NextResponse.json({ error: "Este pedido já foi pago." }, { status: 409 });
    const { data: account } = await admin.from("payment_gateway_accounts")
      .select("id,provider,environment,active")
      .eq("establishment_id", order.establishment_id).eq("provider", body.provider).eq("active", true).maybeSingle();
    if (!account) return NextResponse.json({ error: "Meio de pagamento indisponível." }, { status: 409 });
    const idempotencyKey = `${account.provider}:${order.id}`;
    const { error: reserveError } = await admin.from("order_payment_transactions").upsert({
      establishment_id: order.establishment_id, order_id: order.id, gateway_account_id: account.id,
      provider: account.provider, amount_cents: order.total_cents, idempotency_key: idempotencyKey, payment_kind: "hosted",
    }, { onConflict: "establishment_id,idempotency_key", ignoreDuplicates: true });
    if (reserveError) throw new Error("Não foi possível reservar o pagamento.");
    const { data: reserved } = await admin.from("order_payment_transactions").select("payment_kind,checkout_url")
      .eq("establishment_id", order.establishment_id).eq("idempotency_key", idempotencyKey).single();
    if (!reserved || reserved.payment_kind !== "hosted") return NextResponse.json({ error: "Este pedido já possui um Pix. Use o código no acompanhamento." }, { status: 409 });
    if (reserved.checkout_url) return NextResponse.json({ url: reserved.checkout_url });
    const { data: secrets, error: secretError } = await admin.rpc("get_payment_gateway_secret", { requested_account_id: account.id });
    if (secretError || !secrets?.credential) throw new Error("Credencial do gateway não encontrada.");
    const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
    const checkout = await createHostedCheckout({
      provider: account.provider as GatewayProvider,
      environment: account.environment as GatewayEnvironment,
      credential: String(secrets.credential), origin, accountId: account.id,
      order: {
        id: order.id, orderNumber: order.order_number, amountCents: order.total_cents,
        customerName: order.customer_name, trackingToken: order.tracking_token,
        establishmentSlug: establishment.slug,
      },
    });
    const { error: recordError } = await admin.rpc("record_online_payment_session", {
      requested_order_id: order.id, requested_gateway_account_id: account.id,
      requested_external_id: checkout.externalId, requested_checkout_url: checkout.checkoutUrl,
      requested_idempotency_key: idempotencyKey,
    });
    if (recordError) throw recordError;
    return NextResponse.json({ url: checkout.checkoutUrl });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível iniciar o pagamento." }, { status: 500 });
  }
}
