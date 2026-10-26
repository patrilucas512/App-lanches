import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchMercadoPagoPayment, normalizePaymentStatus, verifyMercadoPagoSignature } from "@/lib/order-payments/providers";
import { reconcileTablePix } from "@/lib/order-payments/table-pix";

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const accountId = url.searchParams.get("account");
    const event = await request.json() as { data?: { id?: string | number } };
    const paymentId = String(event.data?.id || url.searchParams.get("data.id") || "");
    if (!accountId || !paymentId) return NextResponse.json({ error: "Evento incompleto." }, { status: 400 });
    const admin = createAdminClient();
    const { data: account } = await admin.from("payment_gateway_accounts").select("id,environment").eq("id", accountId).eq("provider", "mercado_pago").maybeSingle();
    if (!account) return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
    const { data: secrets } = await admin.rpc("get_payment_gateway_secret", { requested_account_id: account.id });
    if (!secrets?.credential) throw new Error("Credencial ausente.");
    if (!verifyMercadoPagoSignature({ signature: request.headers.get("x-signature"), requestId: request.headers.get("x-request-id"), dataId: paymentId, secret: secrets.webhook_secret }))
      return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
    const payment = await fetchMercadoPagoPayment(String(secrets.credential), paymentId);
    const reference = String(payment.external_reference || "");
    const { data: tableCharge } = /^[0-9a-f-]{36}$/i.test(reference)
      ? await admin.from("order_payment_transactions").select("id,amount_cents")
        .eq("id", reference).eq("gateway_account_id", account.id).not("table_session_id", "is", null).maybeSingle()
      : { data: null };
    if (tableCharge) {
      await reconcileTablePix(admin, account.id, tableCharge, payment);
      return NextResponse.json({ received: true });
    }
    const amountCents = Math.round(Number(payment.transaction_amount || 0) * 100);
    const { error } = await admin.rpc("confirm_online_order_payment", {
      requested_gateway_account_id: account.id, requested_external_id: String(payment.preference_id || paymentId),
      requested_status: normalizePaymentStatus(payment.status), requested_raw_status: String(payment.status || ""),
      requested_amount_cents: amountCents, requested_order_id: String(payment.external_reference || "") || null,
    });
    if (error) throw error;
    return NextResponse.json({ received: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Webhook inválido." }, { status: 400 });
  }
}
