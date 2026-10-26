import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchPagarmeOrder, normalizePaymentStatus, type GatewayEnvironment } from "@/lib/order-payments/providers";
import { reconcileSaasCheckout } from "@/lib/saas-payments";

export async function POST(request: Request) {
  try {
    const accountId = new URL(request.url).searchParams.get("account");
    const event = await request.json() as { data?: { id?: string; code?: string; order?: { id?: string } } };
    const providerOrderId = String(event.data?.order?.id || event.data?.id || "");
    if (!accountId || !providerOrderId) return NextResponse.json({ error: "Evento incompleto." }, { status: 400 });
    const admin = createAdminClient();
    const eventId = `${providerOrderId}:${String(event.data?.id || event.data?.code || "order")}`;
    const { data: prior } = await admin.from("saas_gateway_events").select("status").eq("provider", "pagarme").eq("provider_event_id", eventId).maybeSingle();
    if (prior?.status === "processed") return NextResponse.json({ received: true, duplicate: true });
    await admin.from("saas_gateway_events").upsert({ provider: "pagarme", provider_event_id: eventId, event_type: "order.updated", payload_hash: providerOrderId, status: "received", attempts: 1 }, { onConflict: "provider,provider_event_id" });
    const { data: account } = await admin.from("platform_payment_accounts").select("id,environment").eq("id", accountId).eq("provider", "pagarme").maybeSingle();
    if (!account) return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
    const { data: secrets } = await admin.rpc("get_platform_payment_gateway_secret", { requested_account_id: account.id });
    if (!secrets?.credential) throw new Error("Credencial ausente.");
    const order = await fetchPagarmeOrder(account.environment as GatewayEnvironment, String(secrets.credential), providerOrderId);
    const sessionId = String(order.code || event.data?.code || "");
    const status = normalizePaymentStatus(order.status);
    const { data: session } = await admin.from("saas_checkout_sessions").select("id,amount_cents").eq("id", sessionId).eq("provider", "pagarme").maybeSingle();
    if (!session || session.amount_cents !== Number(order.amount || 0)) throw new Error("Cobrança não corresponde ao checkout registrado.");
    await reconcileSaasCheckout(admin, { sessionId: session.id, status, rawStatus: String(order.status || ""), providerReference: providerOrderId });
    await admin.from("saas_gateway_events").update({ status: "processed", processed_at: new Date().toISOString() }).eq("provider", "pagarme").eq("provider_event_id", eventId);
    return NextResponse.json({ received: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Webhook inválido." }, { status: 400 });
  }
}
