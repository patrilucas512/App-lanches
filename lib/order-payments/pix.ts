import { createHash } from "node:crypto";

export type PixPayment = { id: string; status: string; qrCode: string; qrImage: string; expiresAt: string; amountCents: number };

export function readPixPayment(payment: Record<string, any>, orderId: string, amountCents: number): PixPayment {
  if (payment.external_reference !== orderId || payment.payment_method_id !== "pix" ||
    payment.currency_id !== "BRL" || Math.round(Number(payment.transaction_amount) * 100) !== amountCents)
    throw new Error("A cobrança não corresponde a este pedido.");
  const data = payment.point_of_interaction?.transaction_data;
  const qrCode = typeof data?.qr_code === "string" ? data.qr_code : "";
  const base64 = typeof data?.qr_code_base64 === "string" ? data.qr_code_base64 : "";
  if (payment.status === "pending" && (!qrCode || !/^[A-Za-z0-9+/=]+$/.test(base64)))
    throw new Error("O Mercado Pago não retornou um QR Code válido.");
  return { id: String(payment.id), status: String(payment.status), qrCode,
    qrImage: base64 ? `data:image/png;base64,${base64}` : "", expiresAt: String(payment.date_of_expiration || ""), amountCents };
}

export async function createPixPayment(input: { credential: string; accountId: string; origin: string;
  orderId: string; orderNumber: number; amountCents: number; email: string; cpf: string; createdAt: string; description?: string; expiresInMinutes?: number }) {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new Error("Valor do pedido inválido.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) || !/^\d{11}$/.test(input.cpf))
    throw new Error("Informe e-mail e CPF válidos para gerar o Pix.");
  // Keep the request stable on retries and leave a buffer above the provider's
  // minimum expiry window (30 minutes from payment creation).
  const expiryMinutes = Math.min(1440, Math.max(30, Math.trunc(input.expiresInMinutes || 60)));
  const expiresAt = new Date(new Date(input.createdAt).getTime() + expiryMinutes * 60_000).toISOString();
  if (Date.parse(expiresAt) <= Date.now() + 31 * 60_000) throw new Error("O prazo para gerar esta cobrança expirou. Consulte o estabelecimento.");
  const response = await fetch("https://api.mercadopago.com/v1/payments", {
    method: "POST", signal: AbortSignal.timeout(20000), headers: {
      Authorization: `Bearer ${input.credential}`, "Content-Type": "application/json",
      "X-Idempotency-Key": createHash("sha256").update(`masterapp:pix:${input.accountId}:${input.orderId}`).digest("hex"),
    }, body: JSON.stringify({ transaction_amount: input.amountCents / 100, payment_method_id: "pix",
      description: input.description || `Pedido #${input.orderNumber}`, external_reference: input.orderId,
      date_of_expiration: expiresAt, payer: { email: input.email, identification: { type: "CPF", number: input.cpf } },
      notification_url: `${input.origin}/api/order-payments/webhook/mercado-pago?account=${input.accountId}` }),
  });
  const payment = await response.json();
  if (!response.ok) throw new Error("Não foi possível gerar o Pix. Confira os dados e tente novamente.");
  return readPixPayment(payment, input.orderId, input.amountCents);
}
