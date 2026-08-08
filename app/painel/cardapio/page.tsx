import { DashboardShell } from "@/components/dashboard-shell";
import { CatalogManager } from "@/components/catalog-manager";
import { QrCodeManager } from "@/components/qr-code-manager";
import { KitchenPrintSettings } from "@/components/kitchen-print-settings";
import { getDashboardContext } from "@/lib/dashboard";
import { redirect } from "next/navigation";

export default async function CatalogPage() {
  const { supabase, establishment, member } = await getDashboardContext();
  if (!["owner", "manager", "catalog_editor"].includes(member.role)) redirect("/painel/garcom");
  let { data: categories } = await supabase.from("categories").select("id,name,description,active,sort_order").eq("establishment_id", establishment.id).order("sort_order");
  const required = [{ name: "Destaques", description: "Os mais pedidos da casa" }, { name: "Cervejas", description: "Cervejas geladas" }, { name: "Refrigerantes", description: "Refrigerantes e bebidas sem álcool" }];
  for (const item of required) {
    if (!(categories ?? []).some(category => category.name.toLocaleLowerCase("pt-BR") === item.name.toLocaleLowerCase("pt-BR"))) {
      const { data } = await supabase.from("categories").insert({ establishment_id: establishment.id, ...item, sort_order: categories?.length ?? 0 }).select("id,name,description,active,sort_order").single();
      if (data) categories = [...(categories ?? []), data];
    }
  }
  // Calculado por requisição para manter as métricas atuais.
  // eslint-disable-next-line react-hooks/purity
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [{ data: products }, { data: qrSettings }, { data: store }, { data: scans }, { data: qrOrders }, { data: finishedEvents }, { data: serviceMode }] = await Promise.all([
    supabase.from("products").select("id,category_id,name,description,price_cents,active,image_url,ingredients,addon_options").eq("establishment_id", establishment.id).order("created_at", { ascending: false }),
    supabase.from("qr_code_settings").select("*").eq("establishment_id", establishment.id).maybeSingle(),
    supabase.from("establishments").select("name,logo_url,accent_color").eq("id", establishment.id).single(),
    supabase.from("qr_code_scans").select("created_at").eq("establishment_id", establishment.id).gte("created_at", since),
    supabase.from("orders").select("id").eq("establishment_id", establishment.id).eq("source", "qr").gte("created_at", since),
    supabase.from("usage_events").select("order_id").eq("establishment_id", establishment.id).eq("event_type", "order_whatsapp").gte("created_at", since),
    supabase.from("service_modes").select("auto_print_kitchen").eq("establishment_id", establishment.id).maybeSingle(),
  ]);
  const hourCounts = new Map<number, number>();
  for (const scan of scans ?? []) { const hour = new Date(scan.created_at).getHours(); hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1); }
  const peakHour = [...hourCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const qrIds = new Set((qrOrders ?? []).map(order => order.id));
  const finished = (finishedEvents ?? []).filter(event => event.order_id && qrIds.has(event.order_id)).length;
  return <DashboardShell active="catalog" storeSlug={establishment.slug}>
    <header className="dashboard-head"><div><small>CATÁLOGO E ACESSO DO CLIENTE</small><h1>Seu cardápio.</h1></div><span className="status-pill">{products?.length ?? 0} produtos</span></header>
    <CatalogManager establishmentId={establishment.id} initialCategories={categories ?? []} initialProducts={products ?? []} />
    {member.role !== "catalog_editor" && <><KitchenPrintSettings establishmentId={establishment.id} initialEnabled={serviceMode?.auto_print_kitchen ?? false} /><section id="qr-code-cardapio" className="catalog-qr-section"><header><small>QR CODE DO CARDÁPIO</small><h2>Pronto para colocar nas mesas.</h2><p>O QR Code faz parte do seu cardápio e não exige cadastro prévio de mesas.</p></header><QrCodeManager establishmentId={establishment.id} establishmentName={store?.name ?? establishment.name} slug={establishment.slug} initialSettings={{ title: qrSettings?.title ?? "Escaneie e veja o cardápio", subtitle: qrSettings?.subtitle ?? "Faça seu pedido pelo celular", footerText: qrSettings?.footer_text ?? "Aponte a câmera do celular para o QR Code", primaryColor: qrSettings?.primary_color ?? store?.accent_color ?? "#6d2627", logoUrl: qrSettings?.logo_url ?? store?.logo_url ?? "", template: qrSettings?.print_template ?? "simple" }} metrics={{ scans: scans?.length ?? 0, peakHour: peakHour === undefined ? "—" : `${String(peakHour).padStart(2, "0")}:00`, startedOrders: qrOrders?.length ?? 0, finishedOrders: finished }} /></section></>}
  </DashboardShell>;
}
