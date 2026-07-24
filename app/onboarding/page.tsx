import { Brand } from "@/components/ui";
import { OnboardingForm, type OnboardingInitialData } from "@/components/onboarding-form";
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
    .eq("role", "owner")
    .limit(1)
    .maybeSingle();

  let initial: OnboardingInitialData | undefined;
  if (membership) {
    const [{ data: establishment }, { data: settings }] = await Promise.all([
      supabase.from("establishments").select("*").eq("id", membership.establishment_id).single(),
      supabase.from("establishment_settings").select("*").eq("establishment_id", membership.establishment_id).single(),
    ]);
    if (establishment?.onboarding_completed) redirect("/painel");
    if (establishment) {
      initial = {
        hasEstablishment: true,
        name: establishment.name,
        slug: establishment.slug,
        description: establishment.description ?? "",
        phone: establishment.phone ?? "",
        city: establishment.city ?? "",
        state: establishment.state ?? "",
        logoUrl: establishment.logo_url ?? "",
        coverUrl: establishment.cover_url ?? "",
        accentColor: establishment.accent_color ?? "#6d2627",
        secondaryColor: establishment.secondary_color ?? "#f5efe5",
        whatsapp: settings?.whatsapp ?? "",
        address: String(settings?.address?.street ?? ""),
      };
    }
  }

  return (
    <main className="auth-page onboarding-page">
      <aside className="auth-aside">
        <Brand />
        <div className="auth-quote">
          <span className="kicker">CONFIGURAÇÃO GUIADA</span>
          <h2>Sua loja pronta para vender em poucos minutos.</h2>
          <p>Identidade, operação, pagamentos, entrega e o primeiro produto em um único fluxo.</p>
        </div>
        <small>Seu teste gratuito começa agora.</small>
      </aside>
      <section className="auth-main">
        <div className="auth-card onboarding-card">
          <OnboardingForm initial={initial} />
        </div>
      </section>
    </main>
  );
}
