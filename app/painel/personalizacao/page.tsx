import { DashboardShell } from "@/components/dashboard-shell";
import { MenuBrandingManager } from "@/components/menu-branding-manager";
import { getDashboardContext } from "@/lib/dashboard";
import { redirect } from "next/navigation";

export default async function PersonalizationPage() {
  const { supabase, establishment, member } = await getDashboardContext();
  if (!["owner", "manager"].includes(member.role)) redirect("/painel/cardapio");

  const { data: brand } = await supabase
    .from("establishments")
    .select("name,description,logo_url,cover_url,accent_color,secondary_color,menu_display_name,menu_logo_url,menu_background_color,menu_surface_color,menu_text_color,menu_muted_color")
    .eq("id", establishment.id)
    .single();

  return <DashboardShell brand={establishment} active="customize" storeSlug={establishment.slug} role={member.role}>
    <header className="dashboard-head">
      <div><small>GESTÃO DA IDENTIDADE</small><h1>Personalizar site.</h1><p>Nome, logotipo, capa e cores aplicados de forma centralizada.</p></div>
      <span className="status-pill">Todas as áreas</span>
    </header>
    <section className="personalization-scope" aria-label="Áreas conectadas à identidade visual">
      {['Cardápio do cliente', 'Painel administrativo', 'Garçom e mesas', 'Cozinha e caixa', 'Entregas e motoboy'].map(area => <span key={area}>✓ {area}</span>)}
    </section>
    <MenuBrandingManager establishmentId={establishment.id} initial={{
      displayName: brand?.menu_display_name ?? brand?.name ?? establishment.name,
      description: brand?.description ?? "",
      logoUrl: brand?.menu_logo_url ?? brand?.logo_url ?? "",
      coverUrl: brand?.cover_url ?? "",
      accentColor: brand?.accent_color ?? "#ff641f",
      lightColor: brand?.secondary_color ?? "#f6f2e9",
      backgroundColor: brand?.menu_background_color ?? "#080807",
      surfaceColor: brand?.menu_surface_color ?? "#151411",
      textColor: brand?.menu_text_color ?? "#fffaf1",
      mutedColor: brand?.menu_muted_color ?? "#aaa59c",
    }} />
  </DashboardShell>;
}
