import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPixPayment } from "@/lib/order-payments/pix";
import { fetchMercadoPagoPayment } from "@/lib/order-payments/providers";
import { reconcileTablePix } from "@/lib/order-payments/table-pix";

const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin && origin !== process.env.NEXT_PUBLIC_SITE_URL)
      return reply({ error: "Origem inválida." }, 403);
    const body = await request.json();
    if (typeof body.session_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.session_id))
      return reply({ error: "Conta inválida." }, 400);
    const userClient = await createClient();
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return reply({ error: "Entre novamente para continuar." }, 401);
    if (body.create && (typeof body.email !== "string" || typeof body.cpf !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) || !/^\d{11}$/.test(body.cpf)))
      return reply({ error: "Informe e-mail e CPF do pagador." }, 400);
    const { data: charge, error } = await userClient.rpc("reserve_table_pix", {
      requested_session_id: body.session_id, requested_create: body.create === true,
    });
    if (error) return reply({ error: error.message }, 409);
    if (charge.paid || charge.needsPayer || !charge.id) return reply(charge);
    if (["canceled", "declined", "error", "refunded"].includes(charge.status)) return reply({ status: charge.status });
    const admin = createAdminClient();
    const { data: secrets, error: secretError } = await admin.rpc("get_payment_gateway_secret", { requested_account_id: charge.gateway_account_id });
    if (secretError || !secrets?.credential) throw new Error("Pagamento temporariamente indisponível.");
    const credential = String(secrets.credential);
    if (!charge.external_id && !body.create) return reply({ needsPayer: true });
    let payment: Record<string, any>;
    if (charge.external_id) {
      payment = await fetchMercadoPagoPayment(credential, charge.external_id);
      if (body.cancel === true && payment.status === "pending") {
        const result = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(charge.external_id)}`, {
          method: "PUT", signal: AbortSignal.timeout(20000),
          headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
          body: JSON.stringify({ status: "cancelled" }),
        });
        if (!result.ok) throw new Error("Não foi possível cancelar. Consulte o status antes de receber por outro meio.");
        // Do not trust a local cancel action: read the provider again.
        payment = await fetchMercadoPagoPayment(credential, charge.external_id);
      }
    } else {
      const pix = await createPixPayment({ credential, accountId: charge.gateway_account_id,
        origin: process.env.NEXT_PUBLIC_SITE_URL!, orderId: charge.id, orderNumber: 0,
        description: `Conta da mesa ${charge.table_number}`, amountCents: charge.amount_cents,
        email: body.email.trim(), cpf: body.cpf, createdAt: charge.created_at });
      payment = await fetchMercadoPagoPayment(credential, pix.id);
    }
    return reply(await reconcileTablePix(admin, charge.gateway_account_id, charge, payment));
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : "Não foi possível consultar o Pix." }, 400);
  }
}
