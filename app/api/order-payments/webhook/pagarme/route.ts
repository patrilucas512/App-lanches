import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchPagarmeOrder, normalizePaymentStatus, type GatewayEnvironment } from "@/lib/order-payments/providers";

export async function POST(request: Request) {
  try {
    const accountId = new URL(request.url).searchParams.get("account");
    const event = await request.json() as { data?: { id?: string; code?: string; order?: { id?: string } } };
    const providerOrderId = String(event.data?.order?.id || event.data?.id || "");
    if (!accountId || !providerOrderId) return NextResponse.json({ error: "Evento incompleto." }, { status: 400 });
    const admin = createAdminClient();
    const { data: account } = await admin.from("payment_gateway_accounts").select("id,environment").eq("id", accountId).eq("provider", "pagarme").maybeSingle();
    if (!account) return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
    const { data: secrets } = await admin.rpc("get_payment_gateway_secret", { requested_account_id: account.id });
    if (!secrets?.credential) throw new Error("Credencial ausente.");
    // A mudança financeira usa o pedido consultado diretamente no Pagar.me, nunca apenas o JSON recebido.
    const order = await fetchPagarmeOrder(account.environment as GatewayEnvironment, String(secrets.credential), providerOrderId);
    const { error } = await admin.rpc("confirm_online_order_payment", {
      requested_gateway_account_id: account.id,
      requested_external_id: String(order.payment_link_id || order.paymentlink_id || providerOrderId),
      requested_status: normalizePaymentStatus(order.status), requested_raw_status: String(order.status || ""),
      requested_amount_cents: Number(order.amount || 0), requested_order_id: String(order.code || event.data?.code || "") || null,
    });
    if (error) throw error;
    return NextResponse.json({ received: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Webhook inválido." }, { status: 400 });
  }
}
