import { DashboardShell } from "@/components/dashboard-shell";
import { CatalogManager } from "@/components/catalog-manager";
import { AddonGroupsManager } from "@/components/addon-groups-manager";
import { CampaignsManager } from "@/components/campaigns-manager";
import { QrCodeManager } from "@/components/qr-code-manager";
import { getDashboardContext } from "@/lib/dashboard";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function CatalogPage() {
  const { supabase, establishment, member } = await getDashboardContext();
  if (!["owner", "manager", "catalog_editor"].includes(member.role)) redirect("/painel/garcom");
  const { data: categories } = await supabase.from("categories").select("id,name,description,active,sort_order").eq("establishment_id", establishment.id).order("sort_order");
  // Calculado por requisição para manter as métricas atuais.
  // eslint-disable-next-line react-hooks/purity
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [{ data: products }, { data: addonGroups }, { data: campaigns }, { data: qrSettings }, { data: store }, { data: scans }, { data: qrOrders }, { data: finishedEvents }, { data: soldItems }, { data: soldTableItems }, { data: establishmentSettings }] = await Promise.all([
    supabase.from("products").select("id,category_id,name,description,price_cents,compare_at_price_cents,active,featured,sort_order,image_url,ingredients,addon_options,barcode").eq("establishment_id", establishment.id).order("sort_order").order("created_at", { ascending: false }),
    supabase.from("addon_groups").select("id,name,description,min_choices,max_choices,required,active,sort_order,addons(id,name,price_cents,active,sort_order),product_addon_groups(product_id)").eq("establishment_id", establishment.id).order("sort_order"),
    supabase.from("banners").select("id,title,subtitle,image_url,link_url,active,sort_order,starts_at,ends_at,promotion_type,promotion_value,destination_type,destination_id").eq("establishment_id", establishment.id).order("sort_order"),
    supabase.from("qr_code_settings").select("*").eq("establishment_id", establishment.id).maybeSingle(),
    supabase.from("establishments").select("name,logo_url,accent_color,secondary_color,menu_display_name,menu_logo_url,menu_background_color,menu_surface_color,menu_text_color,menu_muted_color").eq("id", establishment.id).single(),
    supabase.from("qr_code_scans").select("created_at").eq("establishment_id", establishment.id).gte("created_at", since),
    supabase.from("orders").select("id").eq("establishment_id", establishment.id).eq("source", "qr").gte("created_at", since),
    supabase.from("usage_events").select("order_id").eq("establishment_id", establishment.id).eq("event_type", "order_whatsapp").gte("created_at", since),
    supabase.from("order_items").select("product_id,quantity").eq("establishment_id", establishment.id).limit(5000),
    supabase.from("table_order_items").select("product_id,quantity").eq("establishment_id", establishment.id).limit(5000),
    supabase.from("establishment_settings").select("estimated_minutes").eq("establishment_id", establishment.id).maybeSingle(),
  ]);
  const hourCounts = new Map<number, number>();
  for (const scan of scans ?? []) { const hour = new Date(scan.created_at).getHours(); hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1); }
  const peakHour = [...hourCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const qrIds = new Set((qrOrders ?? []).map(order => order.id));
  const finished = (finishedEvents ?? []).filter(event => event.order_id && qrIds.has(event.order_id)).length;
  const salesCounts = [...(soldItems ?? []), ...(soldTableItems ?? [])].reduce<Record<string, number>>((counts, item) => {
    if (item.product_id) counts[item.product_id] = (counts[item.product_id] ?? 0) + item.quantity;
    return counts;
  }, {});
  return <DashboardShell brand={establishment} active="catalog" storeSlug={establishment.slug}>
    <header className="dashboard-head"><div><small>CATÁLOGO E ACESSO DO CLIENTE</small><h1>Seu cardápio.</h1></div><span className="status-pill">{products?.length ?? 0} produtos</span></header>
    {member.role !== "catalog_editor" && <section className="panel catalog-personalization-link"><div><small>IDENTIDADE VISUAL</small><h2>Personalize todo o site em um só lugar.</h2><p>Nome, logotipo, capa e cores são compartilhados com o cardápio e as áreas operacionais.</p></div><Link className="button dark" href="/painel/personalizacao">Abrir personalização</Link></section>}
    <CatalogManager establishmentId={establishment.id} initialCategories={categories ?? []} initialProducts={products ?? []} salesCounts={salesCounts} defaultPreparationMinutes={establishmentSettings?.estimated_minutes ?? 45} />
    <AddonGroupsManager establishmentId={establishment.id} initialGroups={addonGroups ?? []} products={(products ?? []).map(product => ({ id: product.id, name: product.name }))} />
    <CampaignsManager establishmentId={establishment.id} initialCampaigns={campaigns ?? []} categories={(categories ?? []).map(category => ({ id: category.id, name: category.name }))} products={(products ?? []).map(product => ({ id: product.id, name: product.name }))} />
    {member.role !== "catalog_editor" && <section id="qr-code-cardapio" className="catalog-qr-section"><header><small>QR CODE DO CARDÁPIO</small><h2>Pronto para colocar nas mesas.</h2><p>O QR Code faz parte do seu cardápio e não exige cadastro prévio de mesas.</p></header><QrCodeManager establishmentId={establishment.id} establishmentName={store?.name ?? establishment.name} slug={establishment.slug} initialSettings={{ displayName: qrSettings?.display_name ?? store?.name ?? establishment.name, title: qrSettings?.title ?? "Escaneie e veja o cardápio", subtitle: qrSettings?.subtitle ?? "Faça seu pedido pelo celular", footerText: qrSettings?.footer_text ?? "Aponte a câmera do celular para o QR Code", primaryColor: qrSettings?.primary_color ?? store?.accent_color ?? "#6d2627", logoUrl: qrSettings?.logo_url ?? store?.logo_url ?? "", template: qrSettings?.print_template ?? "simple" }} metrics={{ scans: scans?.length ?? 0, peakHour: peakHour === undefined ? "—" : `${String(peakHour).padStart(2, "0")}:00`, startedOrders: qrOrders?.length ?? 0, finishedOrders: finished }} /></section>}
  </DashboardShell>;
}
