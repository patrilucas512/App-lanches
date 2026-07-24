import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

function mapStatus(status: Stripe.Subscription.Status) {
  if (status === "trialing" || status === "active" || status === "past_due" || status === "canceled" || status === "unpaid" || status === "incomplete") return status;
  return status === "incomplete_expired" ? "canceled" : "past_due";
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) return NextResponse.json({ error: "Webhook não configurado." }, { status: 400 });
  let event: Stripe.Event;
  try { event = await getStripe().webhooks.constructEventAsync(await request.text(), signature, secret); }
  catch { return NextResponse.json({ error: "Assinatura inválida." }, { status: 400 }); }

  const admin = createAdminClient();
  const { data: processed } = await admin.from("stripe_events").select("id").eq("id", event.id).maybeSingle();
  if (processed) return NextResponse.json({ received: true });

  try {
    if (event.type.startsWith("customer.subscription.")) {
      const subscription = event.data.object as Stripe.Subscription;
      const establishmentId = subscription.metadata.establishment_id;
      const planId = subscription.metadata.plan_id;
      if (establishmentId) {
        const item = subscription.items.data[0];
        await admin.from("subscriptions").update({
          status: mapStatus(subscription.status),
          stripe_subscription_id: subscription.id,
          stripe_customer_id: String(subscription.customer),
          plan_id: planId || undefined,
          current_period_end: item?.current_period_end ? new Date(item.current_period_end * 1000).toISOString() : null,
          cancel_at_period_end: subscription.cancel_at_period_end,
        }).eq("establishment_id", establishmentId);
      }
    }
    if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = String(invoice.customer);
      const { data: subscription } = await admin.from("subscriptions").select("establishment_id").eq("stripe_customer_id", customerId).maybeSingle();
      if (subscription) await admin.from("subscription_invoices").upsert({
        establishment_id: subscription.establishment_id,
        stripe_invoice_id: invoice.id,
        status: invoice.status,
        amount_paid_cents: invoice.amount_paid,
        hosted_invoice_url: invoice.hosted_invoice_url,
      }, { onConflict: "stripe_invoice_id" });
    }
    await admin.from("stripe_events").insert({ id: event.id, event_type: event.type });
    return NextResponse.json({ received: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Webhook falhou." }, { status: 500 });
  }
}
