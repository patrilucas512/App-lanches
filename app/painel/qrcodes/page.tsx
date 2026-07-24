import { DashboardShell } from "@/components/dashboard-shell";
import { QrCodeManager } from "@/components/qr-code-manager";
import { getDashboardContext } from "@/lib/dashboard";

export default async function QrCodesPage() {
  const { supabase, establishment } = await getDashboardContext();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [{ data: tables }, { data: settings }, { data: store }, { data: scans }, { data: qrOrders }, { data: finishedEvents }, { data: operation }] = await Promise.all([
    supabase.from("restaurant_tables").select("*").eq("establishment_id", establishment.id).order("table_number"),
    supabase.from("qr_code_settings").select("*").eq("establishment_id", establishment.id).maybeSingle(),
    supabase.from("establishments").select("name, logo_url, accent_color").eq("id", establishment.id).single(),
    supabase.from("qr_code_scans").select("table_id, created_at").eq("establishment_id", establishment.id).gte("created_at", since),
    supabase.from("orders").select("id").eq("establishment_id", establishment.id).eq("source", "qr").gte("created_at", since),
    supabase.from("usage_events").select("order_id").eq("establishment_id", establishment.id).eq("event_type", "order_whatsapp").gte("created_at", since),
    supabase.from("establishment_settings").select("waiter_calls_enabled").eq("establishment_id", establishment.id).single(),
  ]);
  const tableCounts = new Map<string, number>();
  const hourCounts = new Map<number, number>();
  for (const scan of scans ?? []) {
    if (scan.table_id) tableCounts.set(scan.table_id, (tableCounts.get(scan.table_id) ?? 0) + 1);
    const hour = new Date(scan.created_at).getHours();
    hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
  }
  const mostAccessedId = [...tableCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const peakHour = [...hourCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const qrOrderIds = new Set((qrOrders ?? []).map(order => order.id));
  const finished = (finishedEvents ?? []).filter(event => event.order_id && qrOrderIds.has(event.order_id)).length;
  return <DashboardShell active="qrcodes" storeSlug={establishment.slug}>
    <header className="dashboard-head"><div><small>ACESSO PELO CELULAR</small><h1>QR Codes do cardápio.</h1></div><span className="status-pill">● Pronto para imprimir</span></header>
    <QrCodeManager
      establishmentId={establishment.id} establishmentName={store?.name ?? establishment.name}
      slug={establishment.slug} initialTables={tables ?? []}
      initialSettings={{
        title: settings?.title ?? "Escaneie e veja o cardápio",
        subtitle: settings?.subtitle ?? "Faça seu pedido pelo celular",
        footerText: settings?.footer_text ?? "Aponte a câmera do celular para o QR Code",
        primaryColor: settings?.primary_color ?? store?.accent_color ?? "#6d2627",
        logoUrl: settings?.logo_url ?? store?.logo_url ?? "",
        template: settings?.print_template ?? "simple",
        waiterCallsEnabled: operation?.waiter_calls_enabled ?? false,
      }}
      metrics={{
        scans: scans?.length ?? 0,
        topTable: (tables ?? []).find(table => table.id === mostAccessedId)?.table_number ?? "—",
        peakHour: peakHour === undefined ? "—" : `${String(peakHour).padStart(2, "0")}:00`,
        startedOrders: qrOrders?.length ?? 0, finishedOrders: finished,
      }}
    />
  </DashboardShell>;
}
