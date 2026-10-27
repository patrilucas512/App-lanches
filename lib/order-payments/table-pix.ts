import type { createAdminClient } from "@/lib/supabase/admin";
import { readPixPayment } from "./pix";
import { normalizePaymentStatus } from "./providers";

// Both polling and signed webhooks use the same trusted-provider validation.
export async function reconcileTablePix(admin: ReturnType<typeof createAdminClient>, accountId: string,
  transaction: { id: string; amount_cents: number }, payment: Record<string, any>) {
  const { data: account, error: accountError } = await admin.from("payment_gateway_accounts")
    .select("environment").eq("id", accountId).eq("provider", "mercado_pago").single();
  if (accountError || !account || payment.live_mode !== (account.environment === "production"))
    throw new Error("Ambiente da cobrança não corresponde à conta configurada.");
  const pix = readPixPayment(payment, transaction.id, transaction.amount_cents);
  const { data, error } = await admin.rpc("confirm_online_table_payment", {
    requested_transaction_id: transaction.id, requested_account_id: accountId,
    requested_external_id: pix.id, requested_status: normalizePaymentStatus(pix.status),
    requested_amount_cents: pix.amountCents,
  });
  if (error) throw new Error("Pagamento em conferência. Aguarde e consulte novamente.");
  return { pix, status: data.status as string };
}
