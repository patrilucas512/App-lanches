import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPixPayment, readPixPayment } from "@/lib/order-payments/pix";
import { fetchMercadoPagoPayment, normalizePaymentStatus } from "@/lib/order-payments/providers";

const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (typeof body.tracking_token !== "string" || body.tracking_token.length < 16) return reply({ error: "Pedido inválido." }, 400);
    const admin = createAdminClient();
    const { data: order, error } = await admin.from("orders")
      .select("id,order_number,establishment_id,payment_method,fulfillment_type,total_cents,online_payment_status,status")
      .eq("tracking_token", body.tracking_token).maybeSingle();
    if (error || !order) return reply({ error: "Pedido não encontrado." }, 404);
    if (order.payment_method !== "mercado_pago_online" || !["pickup", "takeaway", "delivery"].includes(order.fulfillment_type))
      return reply({ error: "Pix online disponível para retirada, viagem e entrega." }, 409);
    if (order.online_payment_status !== "pending") return reply({ status: order.online_payment_status });
    if (["canceled", "cancelled"].includes(order.status)) return reply({ error: "Pedido cancelado." }, 409);
    const { data: account } = await admin.from("payment_gateway_accounts").select("id")
      .eq("establishment_id", order.establishment_id).eq("provider", "mercado_pago").eq("active", true).maybeSingle();
    if (!account) return reply({ error: "Mercado Pago indisponível." }, 409);
    const key = `mercado_pago:${order.id}`;
    let { data: transaction } = await admin.from("order_payment_transactions").select("id,external_id,payment_kind,created_at,checkout_url")
      .eq("establishment_id", order.establishment_id).eq("idempotency_key", key).maybeSingle();
    if (transaction && transaction.payment_kind !== "pix") return reply({ hostedUrl: transaction.checkout_url, error: transaction.checkout_url ? undefined : "Checkout em preparação. Tente novamente." });
    if (!transaction && !body.create) return reply({ needsPayer: true });
    if (!transaction) {
      if (typeof body.email !== "string" || typeof body.cpf !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) || !/^\d{11}$/.test(body.cpf))
        return reply({ error: "Informe e-mail e CPF válidos." }, 400);
      const { error: reserveError } = await admin.from("order_payment_transactions").upsert({
        establishment_id: order.establishment_id, order_id: order.id, gateway_account_id: account.id,
        provider: "mercado_pago", amount_cents: order.total_cents, idempotency_key: key, payment_kind: "pix",
      }, { onConflict: "establishment_id,idempotency_key", ignoreDuplicates: true });
      if (reserveError) throw new Error("Não foi possível reservar a cobrança.");
      ({ data: transaction } = await admin.from("order_payment_transactions").select("id,external_id,payment_kind,created_at,checkout_url")
        .eq("establishment_id", order.establishment_id).eq("idempotency_key", key).single());
    }
    if (!transaction || transaction.payment_kind !== "pix") return reply({ error: "Outra forma de pagamento já foi iniciada." }, 409);
    if (!transaction.external_id && !body.create) return reply({ needsPayer: true });
    const { data: secrets, error: secretError } = await admin.rpc("get_payment_gateway_secret", { requested_account_id: account.id });
    if (secretError || !secrets?.credential) throw new Error("Pagamento temporariamente indisponível.");
    let pix;
    if (transaction.external_id) {
      const payment = await fetchMercadoPagoPayment(String(secrets.credential), transaction.external_id);
      pix = readPixPayment(payment, order.id, order.total_cents);
    } else {
      pix = await createPixPayment({ credential: String(secrets.credential), accountId: account.id,
        origin: process.env.NEXT_PUBLIC_SITE_URL!, orderId: order.id, orderNumber: order.order_number,
        amountCents: order.total_cents, email: String(body.email || "").trim(), cpf: String(body.cpf || ""), createdAt: transaction.created_at });
      const { error: saveError } = await admin.from("order_payment_transactions").update({ external_id: pix.id })
        .eq("id", transaction.id).eq("gateway_account_id", account.id);
      if (saveError) throw new Error("Cobrança gerada. Tente novamente para recuperar o mesmo Pix.");
    }
    if (pix.status !== "pending") {
      const { error: confirmError } = await admin.rpc("confirm_online_order_payment", {
        requested_gateway_account_id: account.id, requested_external_id: pix.id,
        requested_status: normalizePaymentStatus(pix.status), requested_raw_status: pix.status,
        requested_amount_cents: pix.amountCents, requested_order_id: order.id,
      });
      if (confirmError) throw new Error("Confirmação em processamento. Aguarde e consulte novamente.");
    }
    return reply({ pix, status: normalizePaymentStatus(pix.status) });
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : "Falha ao consultar o Pix." }, 400);
  }
}
