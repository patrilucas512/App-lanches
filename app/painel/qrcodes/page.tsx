import { DashboardShell } from "@/components/dashboard-shell";
import { QrCodeManager } from "@/components/qr-code-manager";
import { getDashboardContext } from "@/lib/dashboard";
import { redirect } from "next/navigation";

export default async function QrCodesPage() {
  const { supabase, establishment, member } = await getDashboardContext();
  if (!["owner", "manager"].includes(member.role)) redirect("/painel/garcom");
  // Server-side reporting window is intentionally calculated for each request.
  // eslint-disable-next-line react-hooks/purity
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [{ data: settings }, { data: store }, { data: scans }, { data: qrOrders }, { data: finishedEvents }] = await Promise.all([
    supabase.from("qr_code_settings").select("*").eq("establishment_id", establishment.id).maybeSingle(),
    supabase.from("establishments").select("name, logo_url, accent_color").eq("id", establishment.id).single(),
    supabase.from("qr_code_scans").select("created_at").eq("establishment_id", establishment.id).gte("created_at", since),
    supabase.from("orders").select("id").eq("establishment_id", establishment.id).eq("source", "qr").gte("created_at", since),
    supabase.from("usage_events").select("order_id").eq("establishment_id", establishment.id).eq("event_type", "order_whatsapp").gte("created_at", since),
  ]);
  const hourCounts = new Map<number, number>();
  for (const scan of scans ?? []) {
    const hour = new Date(scan.created_at).getHours();
    hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
  }
  const peakHour = [...hourCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const qrOrderIds = new Set((qrOrders ?? []).map(order => order.id));
  const finished = (finishedEvents ?? []).filter(event => event.order_id && qrOrderIds.has(event.order_id)).length;
  return <DashboardShell active="qrcodes" storeSlug={establishment.slug}>
    <header className="dashboard-head"><div><small>ACESSO PELO CELULAR</small><h1>QR Code do cardápio.</h1></div><span className="status-pill">● Pronto para imprimir</span></header>
    <QrCodeManager
      establishmentId={establishment.id} establishmentName={store?.name ?? establishment.name}
      slug={establishment.slug}
      initialSettings={{
        title: settings?.title ?? "Escaneie e veja o cardápio",
        subtitle: settings?.subtitle ?? "Faça seu pedido pelo celular",
        footerText: settings?.footer_text ?? "Aponte a câmera do celular para o QR Code",
        primaryColor: settings?.primary_color ?? store?.accent_color ?? "#6d2627",
        logoUrl: settings?.logo_url ?? store?.logo_url ?? "",
        template: settings?.print_template ?? "simple",
      }}
      metrics={{
        scans: scans?.length ?? 0,
        peakHour: peakHour === undefined ? "—" : `${String(peakHour).padStart(2, "0")}:00`,
        startedOrders: qrOrders?.length ?? 0, finishedOrders: finished,
      }}
    />
  </DashboardShell>;
}
