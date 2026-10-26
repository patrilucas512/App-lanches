import { createHmac, timingSafeEqual } from "node:crypto";

export type GatewayProvider = "mercado_pago" | "pagarme";
export type GatewayEnvironment = "test" | "production";

export type CheckoutOrder = {
  id: string;
  orderNumber: number;
  amountCents: number;
  customerName: string;
  customerEmail?: string | null;
  trackingToken: string;
  establishmentSlug: string;
};

type CheckoutResult = { externalId: string; checkoutUrl: string };

export type SaasCheckout = {
  id: string;
  planName: string;
  billingCycle: "monthly" | "annual";
  amountCents: number;
  customerName: string;
  customerEmail: string;
  establishmentName: string;
};

const pagarmeBase = (environment: GatewayEnvironment) =>
  environment === "test" ? "https://sdx-api.pagar.me/core/v5" : "https://api.pagar.me/core/v5";

function assertPaymentEnvironment(environment: GatewayEnvironment) {
  const runtime = process.env.MASTERAPP_ENVIRONMENT;
  if (runtime && runtime !== "production" && environment === "production") throw new Error("payment production mode is blocked outside production.");
}

async function checkedJson(response: Response) {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof body.message === "string" ? body.message : `Gateway respondeu HTTP ${response.status}.`;
    throw new Error(message);
  }
  return body;
}

export async function createHostedCheckout(input: {
  provider: GatewayProvider;
  environment: GatewayEnvironment;
  credential: string;
  origin: string;
  accountId: string;
  order: CheckoutOrder;
}): Promise<CheckoutResult> {
  const { provider, environment, credential, origin, accountId, order } = input;
  assertPaymentEnvironment(environment);
  const returnUrl = `${origin}/loja/${order.establishmentSlug}`;
  if (provider === "mercado_pago") {
    const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credential}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `masterapp-${order.id}`,
      },
      body: JSON.stringify({
        external_reference: order.id,
        items: [{ id: order.id, title: `Pedido #${order.orderNumber}`, quantity: 1, currency_id: "BRL", unit_price: order.amountCents / 100 }],
        payer: { name: order.customerName, email: order.customerEmail || undefined },
        notification_url: `${origin}/api/order-payments/webhook/mercado-pago?account=${accountId}`,
        back_urls: { success: returnUrl, pending: returnUrl, failure: returnUrl },
        auto_return: "approved",
      }),
    });
    const body = await checkedJson(response);
    const rawCheckoutUrl = environment === "test" ? body.sandbox_init_point || body.init_point : body.init_point;
    const checkoutUrl = typeof rawCheckoutUrl === "string" ? rawCheckoutUrl.trim() : "";
    if (!body.id || !checkoutUrl) throw new Error("Mercado Pago não retornou o link de pagamento.");
    return { externalId: String(body.id), checkoutUrl };
  }

  const response = await fetch(`${pagarmeBase(environment)}/paymentlinks`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${credential}:`).toString("base64")}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `masterapp-${order.id}`,
    },
    body: JSON.stringify({
      is_building: false,
      type: "order",
      name: `Pedido #${order.orderNumber}`,
      order_code: order.id,
      expires_in: 60,
      max_paid_sessions: 1,
      payment_settings: {
        accepted_payment_methods: ["credit_card", "pix"],
        credit_card_settings: { operation_type: "auth_and_capture", installments: [{ number: 1, total: order.amountCents }] },
        pix_settings: { expires_in: 3600 },
      },
      cart_settings: { items: [{ amount: order.amountCents, name: `Pedido #${order.orderNumber}`, default_quantity: 1 }] },
      success_url: returnUrl,
      skip_checkout_success_page: false,
    }),
  });
  const body = await checkedJson(response);
  const checkoutUrl = String(body.url || body.payment_url || "");
  if (!body.id || !checkoutUrl) throw new Error("Pagar.me não retornou o link de pagamento.");
  return { externalId: String(body.id), checkoutUrl };
}

export async function createSaasHostedCheckout(input: {
  provider: GatewayProvider;
  environment: GatewayEnvironment;
  credential: string;
  origin: string;
  accountId: string;
  checkout: SaasCheckout;
}): Promise<CheckoutResult> {
  const { provider, environment, credential, origin, accountId, checkout } = input;
  assertPaymentEnvironment(environment);
  const cycleLabel = checkout.billingCycle === "annual" ? "anual" : "mensal";
  const title = `MasterApp ${checkout.planName} - ${cycleLabel}`;
  const returnUrl = `${origin}/assinar/resultado?checkout=${checkout.id}`;
  if (provider === "mercado_pago") {
    const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json", "X-Idempotency-Key": `masterapp-saas-${checkout.id}` },
      body: JSON.stringify({
        external_reference: checkout.id,
        items: [{ id: checkout.id, title, description: checkout.establishmentName, quantity: 1, currency_id: "BRL", unit_price: checkout.amountCents / 100 }],
        payer: { name: checkout.customerName, email: checkout.customerEmail },
        notification_url: `${origin}/api/saas/webhook/mercado-pago?account=${accountId}`,
        back_urls: { success: returnUrl, pending: returnUrl, failure: returnUrl },
        auto_return: "approved",
      }),
    });
    const body = await checkedJson(response);
    const rawCheckoutUrl = environment === "test" ? body.sandbox_init_point || body.init_point : body.init_point;
    const checkoutUrl = typeof rawCheckoutUrl === "string" ? rawCheckoutUrl.trim() : "";
    if (!body.id || !checkoutUrl) throw new Error("Mercado Pago não retornou o link da assinatura.");
    return { externalId: String(body.id), checkoutUrl };
  }

  const response = await fetch(`${pagarmeBase(environment)}/paymentlinks`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${credential}:`).toString("base64")}`, "Content-Type": "application/json", "Idempotency-Key": `masterapp-saas-${checkout.id}` },
    body: JSON.stringify({
      is_building: false,
      type: "order",
      name: title,
      order_code: checkout.id,
      max_paid_sessions: 1,
      payment_settings: {
        accepted_payment_methods: ["credit_card", "pix"],
        credit_card_settings: { operation_type: "auth_and_capture", installments: [{ number: 1, total: checkout.amountCents }] },
        pix_settings: { expires_in: 3600 },
      },
      customer_settings: { name: checkout.customerName, email: checkout.customerEmail },
      cart_settings: { items: [{ amount: checkout.amountCents, name: title, default_quantity: 1 }] },
      success_url: returnUrl,
      skip_checkout_success_page: false,
    }),
  });
  const body = await checkedJson(response);
  const checkoutUrl = String(body.url || body.payment_url || "");
  if (!body.id || !checkoutUrl) throw new Error("Pagar.me não retornou o link da assinatura.");
  return { externalId: String(body.id), checkoutUrl };
}

export async function fetchMercadoPagoPayment(credential: string, paymentId: string) {
  return checkedJson(await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${credential}` }, cache: "no-store",
  }));
}

export async function fetchPagarmeOrder(environment: GatewayEnvironment, credential: string, orderId: string) {
  return checkedJson(await fetch(`${pagarmeBase(environment)}/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Basic ${Buffer.from(`${credential}:`).toString("base64")}` }, cache: "no-store",
  }));
}

export function verifyMercadoPagoSignature(input: {
  signature: string | null;
  requestId: string | null;
  dataId: string;
  secret?: string | null;
}) {
  if (!input.secret) return true;
  const parts = Object.fromEntries((input.signature || "").split(",").map((part) => part.trim().split("=", 2)));
  if (!parts.ts || !parts.v1 || !input.requestId) return false;
  const manifest = `id:${input.dataId};request-id:${input.requestId};ts:${parts.ts};`;
  const expected = createHmac("sha256", input.secret).update(manifest).digest("hex");
  const received = String(parts.v1);
  return expected.length === received.length && timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

export function normalizePaymentStatus(status: unknown) {
  const value = String(status || "").toLowerCase();
  if (["approved", "paid"].includes(value)) return "approved";
  if (["rejected", "failed", "declined", "payment_failed"].includes(value)) return "declined";
  if (["cancelled", "canceled", "closed"].includes(value)) return "canceled";
  if (["refunded", "chargedback"].includes(value)) return "refunded";
  return "pending";
}
