import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchMercadoPagoPayment, normalizePaymentStatus, verifyMercadoPagoSignature } from "@/lib/order-payments/providers";
import { reconcileSaasCheckout } from "@/lib/saas-payments";

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const accountId = url.searchParams.get("account");
    const event = await request.json() as { data?: { id?: string | number } };
    const paymentId = String(event.data?.id || url.searchParams.get("data.id") || "");
    if (!accountId || !paymentId) return NextResponse.json({ error: "Evento incompleto." }, { status: 400 });
    const admin = createAdminClient();
    const eventId = `${paymentId}:${request.headers.get("x-request-id") || "payment"}`;
    const { data: prior } = await admin.from("saas_gateway_events").select("status").eq("provider", "mercado_pago").eq("provider_event_id", eventId).maybeSingle();
    if (prior?.status === "processed") return NextResponse.json({ received: true, duplicate: true });
    await admin.from("saas_gateway_events").upsert({ provider: "mercado_pago", provider_event_id: eventId, event_type: "payment.updated", payload_hash: paymentId, status: "received", attempts: 1 }, { onConflict: "provider,provider_event_id" });
    const { data: account } = await admin.from("platform_payment_accounts").select("id").eq("id", accountId).eq("provider", "mercado_pago").maybeSingle();
    if (!account) return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
    const { data: secrets } = await admin.rpc("get_platform_payment_gateway_secret", { requested_account_id: account.id });
    if (!secrets?.credential) throw new Error("Credencial ausente.");
    if (!verifyMercadoPagoSignature({ signature: request.headers.get("x-signature"), requestId: request.headers.get("x-request-id"), dataId: paymentId, secret: secrets.webhook_secret }))
      return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
    const payment = await fetchMercadoPagoPayment(String(secrets.credential), paymentId);
    const sessionId = String(payment.external_reference || "");
    const status = normalizePaymentStatus(payment.status);
    const amountCents = Math.round(Number(payment.transaction_amount || 0) * 100);
    const { data: session } = await admin.from("saas_checkout_sessions").select("id,amount_cents").eq("id", sessionId).eq("provider", "mercado_pago").maybeSingle();
    if (!session || session.amount_cents !== amountCents) throw new Error("Cobrança não corresponde ao checkout registrado.");
    await admin.from("saas_checkout_sessions").update({ external_id: String(payment.preference_id || paymentId) }).eq("id", session.id);
    await reconcileSaasCheckout(admin, { sessionId: session.id, status, rawStatus: String(payment.status || ""), providerReference: paymentId });
    await admin.from("saas_gateway_events").update({ status: "processed", processed_at: new Date().toISOString() }).eq("provider", "mercado_pago").eq("provider_event_id", eventId);
    return NextResponse.json({ received: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Webhook inválido." }, { status: 400 });
  }
}
