import { Brand } from "@/components/ui";
import { OnboardingForm } from "@/components/onboarding-form";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");

  const { data: membership } = await supabase
    .from("establishment_members")
    .select("establishment_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (membership) redirect("/painel");

  return <main className="auth-page"><aside className="auth-aside"><Brand /><div className="auth-quote"><span className="kicker">PRIMEIRO PASSO</span><h2>Vamos preparar a sua nova casa digital.</h2><p>Você poderá configurar cores, horários, entrega, produtos e equipe logo depois.</p></div><small>Seu teste gratuito começa agora.</small></aside><section className="auth-main"><div className="auth-card"><h1>Conte sobre seu negócio.</h1><p>Criaremos um ambiente exclusivo e isolado para o seu estabelecimento.</p><OnboardingForm /></div></section></main>;
}
