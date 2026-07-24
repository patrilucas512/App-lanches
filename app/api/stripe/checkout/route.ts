import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: claims } = await supabase.auth.getClaims();
    const userId = claims?.claims?.sub;
    if (!userId) return NextResponse.json({ error: "Faça login para assinar." }, { status: 401 });
    const { data: membership } = await supabase.from("establishment_members").select("establishment_id, role").eq("user_id", userId).eq("role", "owner").limit(1).maybeSingle();
    if (!membership) return NextResponse.json({ error: "Somente o proprietário pode alterar o plano." }, { status: 403 });
    const { data: plan } = await supabase.from("plans").select("id, stripe_monthly_price_id").eq("code", "growth").eq("active", true).single();
    if (!plan) return NextResponse.json({ error: "Plano não encontrado." }, { status: 404 });
    const priceId = plan?.stripe_monthly_price_id || process.env.STRIPE_GROWTH_MONTHLY_PRICE_ID;
    if (!priceId) return NextResponse.json({ error: "O preço do Stripe ainda não foi configurado." }, { status: 503 });
    const { data: subscription } = await supabase.from("subscriptions").select("stripe_customer_id").eq("establishment_id", membership.establishment_id).single();
    const stripe = getStripe();
    const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
    const admin = createAdminClient();
    let customerId = subscription?.stripe_customer_id;
    if (!customerId) {
      const { data: userData } = await supabase.auth.getUser();
      const customer = await stripe.customers.create({ email: userData.user?.email, metadata: { establishment_id: membership.establishment_id } });
      customerId = customer.id;
      await admin.from("subscriptions").update({ stripe_customer_id: customerId }).eq("establishment_id", membership.establishment_id);
    }
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/painel/assinatura?sucesso=1`,
      cancel_url: `${origin}/painel/assinatura?cancelado=1`,
      subscription_data: { metadata: { establishment_id: membership.establishment_id, plan_id: plan.id } },
      allow_promotion_codes: true,
    });
    return NextResponse.json({ url: session.url });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao iniciar assinatura." }, { status: 500 });
  }
}
