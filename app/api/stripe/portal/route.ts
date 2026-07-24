import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: claims } = await supabase.auth.getClaims();
    const userId = claims?.claims?.sub;
    if (!userId) return NextResponse.json({ error: "Faça login para continuar." }, { status: 401 });
    const { data: membership } = await supabase.from("establishment_members").select("establishment_id, role").eq("user_id", userId).eq("role", "owner").limit(1).maybeSingle();
    if (!membership) return NextResponse.json({ error: "Acesso restrito ao proprietário." }, { status: 403 });
    const { data: subscription } = await supabase.from("subscriptions").select("stripe_customer_id").eq("establishment_id", membership.establishment_id).single();
    if (!subscription?.stripe_customer_id) return NextResponse.json({ error: "Nenhuma assinatura Stripe encontrada." }, { status: 404 });
    const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
    const session = await getStripe().billingPortal.sessions.create({ customer: subscription.stripe_customer_id, return_url: `${origin}/painel/assinatura` });
    return NextResponse.json({ url: session.url });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao abrir o portal." }, { status: 500 });
  }
}
