import type { createAdminClient } from "@/lib/supabase/admin";

export async function reconcileSaasCheckout(admin: ReturnType<typeof createAdminClient>, input: { sessionId: string; status: string; rawStatus: string; providerReference: string }) {
  const { data: session } = await admin.from("saas_checkout_sessions").select("id,plan_id,provider,billing_cycle,amount_cents,customer_email,checkout_url,establishment_id,subscription_id").eq("id", input.sessionId).maybeSingle();
  if (!session) throw new Error("Checkout do SaaS não encontrado.");
  const approved = input.status === "approved";
  await admin.from("saas_checkout_sessions").update({ status: input.status, raw_status: input.rawStatus, approved_at: approved ? new Date().toISOString() : null }).eq("id", session.id);
  if (!approved) return;

  let establishmentId = session.establishment_id;
  let subscriptionId = session.subscription_id;
  if (!establishmentId) {
    const { data: establishment } = await admin.from("establishments").select("id").ilike("email", session.customer_email).limit(1).maybeSingle();
    establishmentId = establishment?.id ?? null;
  }
  if (!establishmentId) return;

  const periodEnd = new Date();
  if (session.billing_cycle === "annual") periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  else periodEnd.setMonth(periodEnd.getMonth() + 1);
  const { data: establishment } = await admin.from("establishments").select("organization_id").eq("id", establishmentId).maybeSingle();
  const organizationId = establishment?.organization_id;
  const { data: subscription } = await admin.from("subscriptions").update({ plan_id: session.plan_id, organization_id: organizationId, status: "active", billing_cycle: session.billing_cycle, provider: session.provider, trial_ends_at: null, current_period_start: new Date().toISOString(), current_period_end: periodEnd.toISOString(), payment_failed_at: null, grace_ends_at: null, suspended_at: null }).eq("establishment_id", establishmentId).select("id").maybeSingle();
  subscriptionId = subscription?.id ?? subscriptionId;
  await admin.from("saas_checkout_sessions").update({ establishment_id: establishmentId, subscription_id: subscriptionId }).eq("id", session.id);

  const { data: invoice } = await admin.from("subscription_invoices").select("id").eq("payment_provider", session.provider).eq("provider_invoice_id", input.providerReference).maybeSingle();
  if (!invoice) await admin.from("subscription_invoices").insert({ establishment_id: establishmentId, stripe_invoice_id: null, status: "paid", amount_paid_cents: session.amount_cents, hosted_invoice_url: session.checkout_url, payment_provider: session.provider, provider_invoice_id: input.providerReference });
  if (organizationId) {
    const { data: saasInvoice } = await admin.from("saas_invoices").upsert({ organization_id: organizationId, subscription_id: subscriptionId, status: "paid", subtotal_cents: session.amount_cents, total_cents: session.amount_cents, amount_paid_cents: session.amount_cents, period_start: new Date().toISOString(), period_end: periodEnd.toISOString(), paid_at: new Date().toISOString(), hosted_url: session.checkout_url, provider: session.provider, provider_invoice_id: input.providerReference }, { onConflict: "provider,provider_invoice_id" }).select("id").single();
    if (saasInvoice) {
      await admin.from("saas_invoice_items").insert({ invoice_id: saasInvoice.id, item_type: "plan", description: `Assinatura MasterApp · ${session.billing_cycle === "annual" ? "anual" : "mensal"}`, quantity: 1, unit_amount_cents: session.amount_cents, amount_cents: session.amount_cents, metadata: { checkout_session_id: session.id } });
      await admin.from("saas_payments").upsert({ organization_id: organizationId, invoice_id: saasInvoice.id, provider: session.provider, provider_payment_id: input.providerReference, status: "paid", amount_cents: session.amount_cents, paid_at: new Date().toISOString(), metadata: { checkout_session_id: session.id } }, { onConflict: "provider,provider_payment_id" });
      await admin.from("saas_billing_notifications").insert({ organization_id: organizationId, event_type: "payment_confirmed", channel: "in_app", status: "sent", payload: { invoice_id: saasInvoice.id, amount_cents: session.amount_cents }, sent_at: new Date().toISOString() });
    }
  }
}
