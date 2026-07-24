import { DashboardShell } from "@/components/dashboard-shell";
import { CatalogManager } from "@/components/catalog-manager";
import { getDashboardContext } from "@/lib/dashboard";

export default async function CatalogPage() {
  const { supabase, establishment } = await getDashboardContext();
  let { data: category } = await supabase.from("categories").select("id").eq("establishment_id", establishment.id).order("sort_order").limit(1).maybeSingle();
  if (!category) {
    const result = await supabase.from("categories").insert({ establishment_id: establishment.id, name: "Destaques", sort_order: 0 }).select("id").single();
    category = result.data;
  }
  const { data: products } = await supabase.from("products").select("id, name, price_cents, active, image_url").eq("establishment_id", establishment.id).order("created_at", { ascending: false });
  return <DashboardShell active="catalog" storeSlug={establishment.slug}><header className="dashboard-head"><div><small>CATÁLOGO</small><h1>Seu cardápio.</h1></div><span className="status-pill">{products?.length ?? 0} produtos</span></header>{category ? <CatalogManager establishmentId={establishment.id} categoryId={category.id} initialProducts={products ?? []} /> : <article className="panel">Não foi possível preparar o catálogo.</article>}</DashboardShell>;
}
