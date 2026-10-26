import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createSaasHostedCheckout, type GatewayEnvironment, type GatewayProvider } from "@/lib/order-payments/providers";
import { createAdminClient } from "@/lib/supabase/admin";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  try {
    const body = await request.json() as { plan?: string; cycle?: "monthly" | "annual"; provider?: GatewayProvider; name?: string; email?: string; establishment_name?: string };
    const provider = String(body.provider || "") as GatewayProvider;
    const cycle = body.cycle === "annual" ? "annual" : "monthly";
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const establishmentName = String(body.establishment_name || "").trim();
    if (!body.plan || !["mercado_pago", "pagarme"].includes(provider) || name.length < 2 || establishmentName.length < 2 || !emailPattern.test(email))
      return NextResponse.json({ error: "Preencha os dados da contratação corretamente." }, { status: 400 });

    const admin = createAdminClient();
    const [{ data: plan }, { data: account }] = await Promise.all([
      admin.from("plans").select("id,code,name,monthly_price_cents,annual_price_cents,active").eq("code", String(body.plan)).eq("active", true).maybeSingle(),
      admin.from("platform_payment_accounts").select("id,provider,environment,active").eq("provider", provider).eq("active", true).maybeSingle(),
    ]);
    if (!plan) return NextResponse.json({ error: "Plano indisponível." }, { status: 404 });
    const amountCents = cycle === "annual" ? plan.annual_price_cents : plan.monthly_price_cents;
    if (amountCents > 0 && !account) return NextResponse.json({ error: "Forma de pagamento temporariamente indisponível." }, { status: 409 });

    const id = randomUUID();
    const idempotencyKey = `${provider}:${id}`;
    const { error: reserveError } = await admin.from("saas_checkout_sessions").insert({
      id, plan_id: plan.id, provider, billing_cycle: cycle, amount_cents: amountCents,
      customer_name: name, customer_email: email, establishment_name: establishmentName,
      idempotency_key: idempotencyKey,
    });
    if (reserveError) throw reserveError;

    if (amountCents === 0) {
      await admin.from("saas_checkout_sessions").update({ status: "approved", raw_status: "free_plan", approved_at: new Date().toISOString() }).eq("id", id);
      const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
      return NextResponse.json({ url: `${origin}/assinar/resultado?checkout=${id}` });
    }

    const { data: secrets, error: secretError } = await admin.rpc("get_platform_payment_gateway_secret", { requested_account_id: account!.id });
    if (secretError || !secrets?.credential) throw new Error("A credencial do banco ainda não foi configurada.");
    const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
    const checkout = await createSaasHostedCheckout({
      provider, environment: account!.environment as GatewayEnvironment, credential: String(secrets.credential), origin, accountId: account!.id,
      checkout: { id, planName: plan.name, billingCycle: cycle, amountCents, customerName: name, customerEmail: email, establishmentName },
    });
    const { error: updateError } = await admin.from("saas_checkout_sessions").update({ external_id: checkout.externalId, checkout_url: checkout.checkoutUrl }).eq("id", id);
    if (updateError) throw updateError;
    return NextResponse.json({ url: checkout.checkoutUrl });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível gerar o pagamento." }, { status: 500 });
  }
}
