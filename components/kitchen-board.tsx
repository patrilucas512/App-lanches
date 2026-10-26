"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { subscribeToPush, supportsPushNotifications } from "@/lib/push-notifications";
import { getCurrentOperatingWindow, saoPauloDateKey, type BusinessHour } from "@/lib/business-hours";
import { KitchenHistory } from "@/components/kitchen-history";

type Ticket = { id: string; table_order_id?: string | null; public_order_id?: string | null; status: string; created_at: string; delivered_at?: string | null; delivered_by_name?: string | null };
type TableOrder = { id: string; table_session_id: string; order_number: number; notes?: string | null };
type PublicOrder = { id: string; order_number: number; notes?: string | null; customer_name: string; fulfillment_type: string; restaurant_table_id?: string | null; payment_method?: string | null; total_cents: number; cash_received_cents?: number | null; cash_change_cents?: number | null };
type TableItem = { id: string; table_order_id: string; product_name: string; quantity: number; notes?: string | null; addons: { name: string }[]; removed_ingredients: string[] };
type PublicItem = { id: string; order_id: string; product_name: string; quantity: number; notes?: string | null; addons: { name: string }[]; removed_ingredients: string[] };
type Delivery = { id: string; order_id: string; status: string; ready_at?: string | null };
type DeliveryDestination = { delivery_order_id: string; recipient_name: string; recipient_phone: string; postal_code?: string | null; street: string; street_number: string; complement?: string | null; neighborhood: string; city?: string | null; state?: string | null; reference?: string | null };
type Initial = { tickets: Ticket[]; tableOrders: TableOrder[]; publicOrders: PublicOrder[]; deliveries: Delivery[]; deliveryDestinations: DeliveryDestination[]; sessions: { id: string; table_id: string; customer_name?: string | null }[]; tables: { id: string; table_number: string; table_name?: string | null }[]; tableItems: TableItem[]; publicItems: PublicItem[] };
type DirectPrinter = { configured: boolean; online: boolean; id?: string | null; name?: string | null; printer_name?: string | null };
type KitchenPrinterDevice = { id: string; name: string; sector: string; active: boolean };
type PrinterActivation = { id: string; name: string; token: string };
const columns = [["received", "Novos pedidos"], ["preparing", "Em preparo"], ["ready", "Prontos"], ["delivered", "Entregues"]];
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const formatPostalCode = (value?: string | null) => {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : String(value || "").trim();
};
const deliveryAddressLines = (destination?: DeliveryDestination) => {
  if (!destination) return [];
  const street = [destination.street, destination.street_number].filter(Boolean).join(", ");
  const firstLine = [street, destination.complement].filter(Boolean).join(" - ");
  const cityState = [destination.city, destination.state].filter(Boolean).join("/");
  const secondLine = [destination.neighborhood, cityState].filter(Boolean).join(" - ");
  const postalCode = formatPostalCode(destination.postal_code);
  return [firstLine, secondLine, postalCode ? `CEP: ${postalCode}` : ""].filter(Boolean);
};

export function KitchenBoard({ establishmentId, establishmentName, operatorName, canReturnToAdmin, canPrint, autoPrint, paperWidth, directPrinter, businessHours, initial }: { establishmentId: string; establishmentName: string; operatorName: string; canReturnToAdmin: boolean; canPrint: boolean; autoPrint: boolean; paperWidth: 58 | 80; directPrinter: DirectPrinter; businessHours: BusinessHour[]; initial: Initial }) {
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [message, setMessage] = useState("");
  const updatingTickets = useRef(new Set<string>());
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [pushStatus, setPushStatus] = useState<"unsupported" | "idle" | "active">("idle");
  const [printerStatus, setPrinterStatus] = useState<DirectPrinter>(directPrinter);
  const [activatingPrinter, setActivatingPrinter] = useState(false);
  const [operatingHours, setOperatingHours] = useState<BusinessHour[]>(businessHours);
  const audioContextRef = useRef<AudioContext | null>(null);

  function alertContext() {
    if (!audioContextRef.current || audioContextRef.current.state === "closed") audioContextRef.current = new AudioContext();
    return audioContextRef.current;
  }

  async function armKitchenAlert() {
    try {
      const context = alertContext();
      if (context.state !== "running") await context.resume();
      return context.state === "running";
    } catch { return false; }
  }

  function playKitchenAlert() {
    try {
      const context = alertContext();
      void context.resume();
      for (let pulse = 0; pulse < 30; pulse += 1) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = context.currentTime + pulse * .5;
        oscillator.connect(gain); gain.connect(context.destination);
        oscillator.type = "square";
        oscillator.frequency.value = pulse % 2 ? 740 : 940;
        gain.gain.setValueAtTime(.0001, start);
        gain.gain.exponentialRampToValueAtTime(.14, start + .02);
        gain.gain.setValueAtTime(.14, start + .22);
        gain.gain.exponentialRampToValueAtTime(.0001, start + .34);
        oscillator.start(start); oscillator.stop(start + .36);
      }
    } catch {}
  }

  useEffect(() => {
    const unlockAudio = () => { void armKitchenAlert(); };
    window.addEventListener("pointerdown", unlockAudio, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      if (audioContextRef.current?.state !== "closed") void audioContextRef.current?.close();
      audioContextRef.current = null;
    };
  }, []);

  useEffect(() => {
    async function refreshOperationalSettings() {
      const [{ data: status }, { data: hours }] = await Promise.all([
        supabase.rpc("get_printer_connector_status", { requested_establishment_id: establishmentId }),
        supabase.from("business_hours").select("weekday,opens_at,closes_at,closed").eq("establishment_id", establishmentId).order("weekday"),
      ]);
      if (status && typeof status === "object") setPrinterStatus(status as DirectPrinter);
      if (hours) setOperatingHours(hours);
    }
    void refreshOperationalSettings();
    const timer = window.setInterval(() => void refreshOperationalSettings(), 4000);
    return () => window.clearInterval(timer);
  }, [establishmentId, supabase]);

  async function enablePushNotifications(askPermission = true) {
    const audioReady = await armKitchenAlert();
    if (!supportsPushNotifications()) { setPushStatus("unsupported"); return; }
    const subscription = await subscribeToPush(askPermission).catch(() => null);
    if (!subscription) { setPushStatus("idle"); return; }
    const { error } = await supabase.rpc("register_kitchen_push_subscription", { requested_establishment_id: establishmentId, requested_subscription: subscription });
    if (error) setMessage(error.message); else {
      setPushStatus("active");
      setMessage(audioReady ? "Alertas ativados. O som de novo pedido tocará por 15 segundos." : "Notificações ativadas. Toque em Testar alerta para liberar o som neste aparelho.");
    }
  }

  async function activateKitchenPrinter() {
    if (activatingPrinter) return;
    setActivatingPrinter(true);
    setMessage("Ativando a impressora da cozinha...");
    try {
      let deviceId = printerStatus.id || null;
      if (!deviceId) {
        const { data: devices, error: listError } = await supabase.rpc("list_printer_devices", { requested_establishment_id: establishmentId });
        if (listError) { setMessage(listError.message); return; }
        const kitchenPrinter = Array.isArray(devices) ? (devices as KitchenPrinterDevice[]).find(device => device.sector === "kitchen") : undefined;
        if (!kitchenPrinter) { setMessage("Nenhuma impressora de cozinha cadastrada. Cadastre uma em Configurações."); return; }
        deviceId = kitchenPrinter.id;
      }
      const { data: activation, error: activationError } = await supabase.rpc("prepare_printer_device_activation", { requested_device_id: deviceId });
      if (activationError) { setMessage(activationError.message); return; }
      const prepared = activation as PrinterActivation;
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      if (!supabaseUrl || !publishableKey || !prepared?.token) { setMessage("Não foi possível preparar o ativador da impressora."); return; }
      const siteBaseUrl = window.location.origin;
      const command = `@echo off\r\ntitle Ativar impressora da cozinha\r\nset "MV_INSTALLER=%TEMP%\\MesaVivaInstaller.ps1"\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing -Uri '${siteBaseUrl}/mesa-viva-installer.ps1' -OutFile '%MV_INSTALLER%'"\r\nif errorlevel 1 goto erro\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%MV_INSTALLER%" -SupabaseUrl "${supabaseUrl}" -AnonKey "${publishableKey}" -DeviceToken "${prepared.token}" -SiteBaseUrl "${siteBaseUrl}"\r\nif errorlevel 1 goto erro\r\ndel "%MV_INSTALLER%" >nul 2>&1\r\necho Impressora ativada. O conector iniciara sozinho com o Windows.\r\npause\r\ndel "%~f0"\r\nexit /b 0\r\n:erro\r\necho Nao foi possivel ativar a impressora.\r\npause\r\nexit /b 1\r\n`;
      const anchor = document.createElement("a");
      anchor.href = URL.createObjectURL(new Blob([command], { type: "application/octet-stream" }));
      anchor.download = `Ativar-${(prepared.name || "Impressora-Cozinha").replace(/[^a-z0-9]+/gi,"-")}.cmd`;
      anchor.click();
      URL.revokeObjectURL(anchor.href);
      setPrinterStatus(current => ({ ...current, configured: true, id: prepared.id, name: prepared.name }));
      setMessage("Ativador baixado. Abra o arquivo uma vez; depois a impressora iniciará automaticamente com o Windows.");
    } finally {
      setActivatingPrinter(false);
    }
  }

  useEffect(() => {
    if (!canReturnToAdmin || printerStatus.configured) return;
    let canceled = false;
    async function enableRegisteredKitchenPrinter() {
      const { data: devices } = await supabase.rpc("list_printer_devices", { requested_establishment_id: establishmentId });
      const kitchenPrinter = Array.isArray(devices) ? (devices as KitchenPrinterDevice[]).find(device => device.sector === "kitchen") : undefined;
      if (!kitchenPrinter || canceled) return;
      const { error } = await supabase.rpc("set_printer_device_active", { requested_device_id: kitchenPrinter.id, requested_active: true });
      if (error || canceled) return;
      const { data: status } = await supabase.rpc("get_printer_connector_status", { requested_establishment_id: establishmentId });
      if (!canceled && status && typeof status === "object") setPrinterStatus(status as DirectPrinter);
    }
    void enableRegisteredKitchenPrinter();
    return () => { canceled = true; };
  }, [canReturnToAdmin, establishmentId, printerStatus.configured, supabase]);

  async function refresh(withAlert = false, insertedId?: string) {
    const [{ data: tickets }, { data: tableOrders }, { data: publicOrders }, { data: deliveries }, { data: deliveryDestinations }, { data: sessions }, { data: tables }, { data: tableItems }, { data: publicItems }] = await Promise.all([
      supabase.from("kitchen_tickets").select("*").eq("establishment_id", establishmentId).neq("status", "canceled").order("created_at"),
      supabase.from("table_orders").select("id,table_session_id,order_number,notes").eq("establishment_id", establishmentId),
      supabase.from("orders").select("id,order_number,notes,customer_name,fulfillment_type,restaurant_table_id,payment_method,total_cents,cash_received_cents,cash_change_cents").eq("establishment_id", establishmentId),
      supabase.from("deliveries").select("id,order_id,status,ready_at").eq("establishment_id", establishmentId),
      supabase.from("delivery_destinations").select("delivery_order_id,recipient_name,recipient_phone,postal_code,street,street_number,complement,neighborhood,city,state,reference").eq("establishment_id", establishmentId),
      supabase.from("table_sessions").select("id,table_id,customer_name").eq("establishment_id", establishmentId),
      supabase.from("restaurant_tables").select("id,table_number,table_name").eq("establishment_id", establishmentId),
      supabase.from("table_order_items").select("id,table_order_id,product_name,quantity,notes,addons,removed_ingredients").eq("establishment_id", establishmentId),
      supabase.from("order_items").select("id,order_id,product_name,quantity,notes,addons,removed_ingredients").eq("establishment_id", establishmentId),
    ]);
    const nextData = tickets && tableOrders && publicOrders && deliveries && deliveryDestinations && sessions && tables && tableItems && publicItems ? { tickets, tableOrders, publicOrders, deliveries, deliveryDestinations, sessions, tables, tableItems, publicItems } as Initial : null;
    if (nextData) setData(nextData);
    if (withAlert) {
      playKitchenAlert();
    }
    if (autoPrint && canPrint && insertedId) {
      const inserted = tickets?.find(ticket => ticket.id === insertedId);
      if (inserted?.status === "received") await supabase.rpc("update_kitchen_ticket", { requested_ticket_id: insertedId, requested_status: "preparing" });
      if (inserted && nextData) {
        if (printerStatus.configured) await queueDirectPrint(inserted, nextData, false);
        else printReceipt(inserted, nextData);
      }
    }
  }

  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      void subscribeToPush(false).then(async subscription => {
        if (!subscription) return;
        const { error } = await supabase.rpc("register_kitchen_push_subscription", { requested_establishment_id: establishmentId, requested_subscription: subscription });
        if (error) setMessage(error.message); else setPushStatus("active");
      }).catch(() => undefined);
    }
    // Reconcile even when a mobile connection misses a Realtime event.
    const timer = window.setInterval(() => { setNow(Date.now()); if (!document.hidden) void refresh(); }, 5000);
    const clearPrint = () => setPrintingId(null);
    window.addEventListener("afterprint", clearPrint);
    const channel = supabase.channel(`kitchen-${establishmentId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "kitchen_tickets", filter: `establishment_id=eq.${establishmentId}` }, payload => { void refresh(true, String(payload.new.id)); })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "kitchen_tickets", filter: `establishment_id=eq.${establishmentId}` }, () => { void refresh(); })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "deliveries", filter: `establishment_id=eq.${establishmentId}` }, () => { void refresh(); })
      .subscribe();
    return () => { clearInterval(timer); window.removeEventListener("afterprint", clearPrint); void supabase.removeChannel(channel); };
  }, [establishmentId, supabase, autoPrint, canPrint, printerStatus.configured, printerStatus.online, printerStatus.printer_name]);

  async function advance(ticket: Ticket, status: string) {
    if (updatingTickets.current.has(ticket.id)) return;
    updatingTickets.current.add(ticket.id);
    try {
    const { error } = await supabase.rpc("update_kitchen_ticket", { requested_ticket_id: ticket.id, requested_status: status });
    if (error) setMessage(error.message); else {
      const detail = details(ticket);
      if (detail.fulfillment === "delivery" && status === "ready") setMessage(`Pedido #${detail.number} liberado para despacho.`);
        await refresh();
      }
    } finally { updatingTickets.current.delete(ticket.id); }
  }

  function details(ticket: Ticket, source = data) {
    if (ticket.public_order_id) {
      const order = source.publicOrders.find(value => value.id === ticket.public_order_id);
      const table = source.tables.find(value => value.id === order?.restaurant_table_id);
      const delivery = source.deliveries.find(value => value.order_id === order?.id);
      const destination = source.deliveryDestinations.find(value => value.delivery_order_id === order?.id);
      return { number: order?.order_number, notes: order?.notes, customer: order?.customer_name, table, payment: order?.payment_method, fulfillment: order?.fulfillment_type, delivery, destination, total: order?.total_cents ?? null, cashReceived: order?.cash_received_cents ?? null, cashChange: order?.cash_change_cents ?? null, items: source.publicItems.filter(value => value.order_id === order?.id) };
    }
    const order = source.tableOrders.find(value => value.id === ticket.table_order_id);
    const session = source.sessions.find(value => value.id === order?.table_session_id);
    const table = source.tables.find(value => value.id === session?.table_id);
    return { number: order?.order_number, notes: order?.notes, customer: session?.customer_name, table, payment: null, fulfillment: "dine_in", delivery: undefined, destination: undefined, total: null, cashReceived: null, cashChange: null, items: source.tableItems.filter(value => value.table_order_id === order?.id) };
  }

  function attendanceLabel(detail: ReturnType<typeof details>, uppercase = false) {
    const label = detail.table?.table_number ? `Mesa ${detail.table.table_number}`
      : detail.fulfillment === "delivery" ? "Entrega"
      : detail.fulfillment === "takeaway" ? "Para viagem"
      : detail.fulfillment === "pickup" ? "Retirada"
      : "Salão";
    return uppercase ? label.toUpperCase() : label;
  }

  function receiptText(ticket: Ticket, source = data) {
    const detail = details(ticket, source);
    const width = paperWidth === 80 ? 48 : 32;
    const line = "-".repeat(width);
    const center = (value: string) => value.slice(0, width).padStart(Math.floor((width + value.slice(0, width).length) / 2)).padEnd(width);
    const rows = [center(establishmentName.toUpperCase()), center(`PEDIDO #${detail.number ?? "-"}`), line];
    rows.push(`ATENDIMENTO: ${attendanceLabel(detail, true)}`);
    if (detail.customer) rows.push(`CLIENTE: ${detail.customer}`);
    if (detail.table?.table_name) rows.push(`LOCAL: ${detail.table.table_name}`);
    if (detail.fulfillment === "delivery") {
      rows.push(line, "ENDERECO DE ENTREGA");
      const addressLines = deliveryAddressLines(detail.destination);
      rows.push(...(addressLines.length ? addressLines : ["ENDERECO NAO DISPONIVEL"]));
      if (detail.destination?.reference) rows.push(`REFERENCIA: ${detail.destination.reference}`);
      if (detail.destination?.recipient_phone) rows.push(`CONTATO: ${detail.destination.recipient_phone}`);
    }
    rows.push(line);
    detail.items.forEach(item => {
      rows.push(`${item.quantity}x ${item.product_name}`);
      if (item.addons?.length) rows.push(`  + ${item.addons.map(addon => addon.name).join(", ")}`);
      if (item.removed_ingredients?.length) rows.push(`*** SEM: ${item.removed_ingredients.join(", ").toUpperCase()} ***`);
      if (item.notes) rows.push(`  OBS: ${item.notes}`);
      rows.push(line);
    });
    if (detail.notes) rows.push(`OBSERVACAO: ${detail.notes}`, line);
    if (detail.payment) rows.push(`PAGAMENTO: ${detail.payment.toUpperCase()}`);
    if (detail.payment === "cash" && detail.total !== null) {
      rows.push(`VALOR DA COMPRA: ${money(detail.total)}`);
      rows.push(`PAGAR EM DINHEIRO: ${money(detail.cashReceived ?? detail.total)}`);
      rows.push(`TROCO: ${money(detail.cashChange ?? 0)}`);
    }
    rows.push(new Date(ticket.created_at).toLocaleString("pt-BR"), center("MESA VIVA"));
    return rows.join("\r\n");
  }

  async function queueDirectPrint(ticket: Ticket, source = data, reprint = false) {
    const { error } = await supabase.rpc("queue_kitchen_print", {
      requested_ticket_id: ticket.id,
      requested_text: receiptText(ticket, source),
      requested_reprint: reprint,
    });
    if (error) { setMessage(error.message); return false; }
    setMessage(printerStatus.online ? `Notinha enviada para ${printerStatus.printer_name || "a impressora"}.` : "Notinha salva na fila. Ela sairá quando o computador da impressora estiver ligado.");
    return true;
  }

  function printReceipt(ticket: Ticket, source = data) {
    const detail = details(ticket, source);
    const items = detail.items.map(item => `<div class="item"><b>${item.quantity}x ${escapeHtml(item.product_name)}</b>${item.addons?.length ? `<span>+ ${item.addons.map(addon => escapeHtml(addon.name)).join(", ")}</span>` : ""}${item.removed_ingredients?.length ? `<strong>SEM: ${item.removed_ingredients.map(escapeHtml).join(", ")}</strong>` : ""}${item.notes ? `<em>${escapeHtml(item.notes)}</em>` : ""}</div>`).join("");
    const frame = document.createElement("iframe");
    frame.title = `Pedido ${detail.number ?? ""}`;
    frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0;";
    frame.onload = () => {
      const printWindow = frame.contentWindow;
      if (!printWindow) { frame.remove(); setMessage("Não foi possível abrir a impressão neste navegador."); return; }
      const cleanup = () => { frame.remove(); setPrintingId(null); };
      printWindow.addEventListener("afterprint", cleanup, { once: true });
      window.setTimeout(cleanup, 60000);
      printWindow.focus();
      printWindow.print();
    };
    setPrintingId(ticket.id);
    const addressLines = deliveryAddressLines(detail.destination);
    const deliveryAddress = detail.fulfillment === "delivery" ? `<div class="address"><b>ENDEREÇO DE ENTREGA</b>${(addressLines.length ? addressLines : ["Endereço não disponível"]).map(value => `<span>${escapeHtml(value)}</span>`).join("")}${detail.destination?.reference ? `<span><strong>Referência:</strong> ${escapeHtml(detail.destination.reference)}</span>` : ""}${detail.destination?.recipient_phone ? `<span><strong>Contato:</strong> ${escapeHtml(detail.destination.recipient_phone)}</span>` : ""}</div>` : "";
    const cashDetails = detail.payment === "cash" && detail.total !== null ? `<div class="payment"><div>VALOR DA COMPRA: ${money(detail.total)}</div><div>PAGAR EM DINHEIRO: ${money(detail.cashReceived ?? detail.total)}</div><div class="change">TROCO: ${money(detail.cashChange ?? 0)}</div></div>` : "";
    frame.srcdoc = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Pedido #${escapeHtml(detail.number)}</title><style>@page{size:${paperWidth}mm 260mm;margin:2mm}*{box-sizing:border-box}html,body{background:#fff;color:#000;margin:0;padding:0}body{width:${paperWidth - 4}mm;font:12px/1.4 monospace}header{text-align:center}h1{font-size:16px;margin:0 0 5px}h2{font-size:22px;margin:8px 0}.line{border-top:1px dashed #000;margin:10px 0}.meta{text-align:center}.meta b,.meta span{display:block}.meta b{font-size:9px;text-transform:uppercase}.address{border:2px solid #000;margin:10px 0;padding:8px;text-align:left}.address>b,.address>span{display:block}.address>b{font-size:11px;margin-bottom:5px;text-align:center}.address>span{font-size:12px;margin-top:2px}.address strong{font-size:10px;text-transform:uppercase}.item{border-bottom:1px dashed #000;padding:9px 0}.item>b{font-size:14px}.item span,.item em{display:block;font-size:11px;margin-top:3px}.item em{font-style:normal}.item strong{border:2px solid #000;display:block;font-size:16px;margin-top:5px;padding:5px;text-align:center}.notes{border:2px solid #000;font-size:13px;font-weight:bold;margin-top:10px;padding:7px}.payment{border-top:1px dashed #000;font-size:12px;font-weight:bold;margin-top:10px;padding-top:8px;text-align:center}.payment .change{border:2px solid #000;font-size:16px;margin-top:6px;padding:5px}.footer{font-size:9px;margin-top:12px;text-align:center}</style></head><body><header><h1>${escapeHtml(establishmentName)}</h1><h2>PEDIDO #${escapeHtml(detail.number ?? "—")}</h2></header><div class="line"></div><div class="meta"><p><b>Atendimento</b><span>${escapeHtml(attendanceLabel(detail))}</span></p>${detail.customer ? `<p><b>Cliente</b><span>${escapeHtml(detail.customer)}</span></p>` : ""}${detail.table?.table_name ? `<p><b>Local</b><span>${escapeHtml(detail.table.table_name)}</span></p>` : ""}</div>${deliveryAddress}<div class="line"></div>${items}${detail.notes ? `<div class="notes">OBSERVAÇÃO: ${escapeHtml(detail.notes)}</div>` : ""}${detail.payment ? `<div class="payment">PAGAMENTO: ${escapeHtml(detail.payment).toUpperCase()}</div>` : ""}${cashDetails}<div class="footer">${new Date(ticket.created_at).toLocaleString("pt-BR")}</div></body></html>`;
    document.body.appendChild(frame);
  }

  async function printOne(ticket: Ticket) {
    const reprint = ticket.status !== "received";
    if (ticket.status === "received") {
      const { error } = await supabase.rpc("update_kitchen_ticket", { requested_ticket_id: ticket.id, requested_status: "preparing" });
      if (error) { setMessage(error.message); return; }
      await refresh();
    }
    if (printerStatus.configured) await queueDirectPrint(ticket, data, reprint);
    else printReceipt(ticket);
  }

  const operatingWindow = getCurrentOperatingWindow(operatingHours, new Date(now));
  const visibleTickets = data.tickets.filter(ticket => ticket.status !== "delivered" || (ticket.delivered_at && saoPauloDateKey(new Date(ticket.delivered_at)) === saoPauloDateKey(new Date(now))));
  const visibleColumns = columns;

  return <main className={`kitchen-page ${printingId ? "printing-one" : ""}`} style={{ "--ticket-width": `${paperWidth}mm` } as React.CSSProperties}>
    <header className="kitchen-head"><div><small>COZINHA · TEMPO REAL</small><h1>{establishmentName}</h1><p>Operador: <b>{operatorName}</b></p>{printerStatus.configured && <p className={`direct-printer-status ${printerStatus.online ? "online" : "offline"}`}><i /> {printerStatus.online ? `Impressora conectada: ${printerStatus.printer_name}` : "Cadastro ativo · falta conectar este computador"}</p>}{canReturnToAdmin && <button type="button" className={`kitchen-printer-activate ${printerStatus.online ? "active" : ""}`} disabled={activatingPrinter || printerStatus.online} onClick={() => void activateKitchenPrinter()}>{activatingPrinter ? "Preparando ativação..." : printerStatus.online ? "Impressora da cozinha ativa" : "Conectar e ativar neste computador"}</button>}{operatingWindow.configured && !operatingWindow.isOpen && <p className="kitchen-closed-note">Expediente encerrado · entregues disponíveis no histórico abaixo</p>}</div><div><span>{visibleTickets.filter(value => value.status !== "delivered").length} comandas ativas</span><div className="kitchen-head-actions">{canReturnToAdmin && <Link className="kitchen-admin-return" href="/painel">← Voltar ao painel administrativo</Link>}{canReturnToAdmin && <Link className="kitchen-admin-return kitchen-register-return" href="/painel/configuracoes#equipe-cozinha">+ Cadastrar responsável</Link>}{pushStatus !== "unsupported" && <button className={`kitchen-notification-button ${pushStatus === "active" ? "active" : ""}`} onClick={() => void enablePushNotifications(true)}>{pushStatus === "active" ? "Alertas ativos · 15 s" : "Ativar alertas"}</button>}<button className="kitchen-notification-button kitchen-test-alert" onClick={() => { void armKitchenAlert().then(() => playKitchenAlert()); }}>Testar alerta 15 s</button></div><Link href="/cozinha/login">Trocar operador</Link></div></header>
    <section className={`kitchen-columns columns-${visibleColumns.length}`}>{visibleColumns.map(([status, title]) => <div className={`kitchen-column column-${status}`} key={status}>
      <header><h2>{title}</h2><b>{visibleTickets.filter(value => value.status === status).length}</b></header>
      <div>{visibleTickets.filter(value => value.status === status).map(ticket => {
        const detail = details(ticket);
        const minutes = Math.max(0, Math.floor((now - new Date(ticket.created_at).getTime()) / 60000));
        return <article className={`kitchen-ticket ${printingId === ticket.id ? "print-target" : ""}`} key={ticket.id}>
          <div className="ticket-top"><div><small>PEDIDO</small><strong>#{detail.number || "—"}</strong></div><div><small>ATENDIMENTO</small><strong>{attendanceLabel(detail, true)}</strong></div><time>{minutes} min</time></div>
          {detail.customer && <div className="ticket-customer"><small>CLIENTE</small><b>{detail.customer}</b>{detail.table?.table_name && <span>{detail.table.table_name}</span>}</div>}
          <div className="ticket-items">{detail.items.map(item => <div key={item.id}>
            <b>{item.quantity}× {item.product_name}</b>
            {item.addons?.length > 0 && <span>+ {item.addons.map(addon => addon.name).join(", ")}</span>}
            {item.removed_ingredients?.length > 0 && <strong className="ticket-removed-alert">SEM: {item.removed_ingredients.join(", ")}</strong>}
            {item.notes && <em>{item.notes}</em>}
          </div>)}</div>
          {detail.notes && <p><b>Observação:</b> {detail.notes}</p>}
          {detail.fulfillment === "delivery" && <div className={`kitchen-delivery-stage stage-${detail.delivery?.status || "pending"}`}><small>FLUXO DE ENTREGA</small><b>{detail.delivery?.status === "ready_for_dispatch" ? "Pronto para despacho" : status === "preparing" ? "Em preparo" : "Pedido recebido"}</b></div>}
          {detail.payment && <small>PAGAMENTO: {detail.payment}</small>}
          {detail.payment === "cash" && detail.total !== null && <div className="ticket-cash-change"><span>COMPRA <b>{money(detail.total)}</b></span><span>CLIENTE PAGA <b>{money(detail.cashReceived ?? detail.total)}</b></span><strong>TROCO: {money(detail.cashChange ?? 0)}</strong></div>}
          <footer>
            {status === "received" && (canPrint ? <button onClick={() => void printOne(ticket)}>{printerStatus.configured ? "Aceitar e imprimir direto" : "Aceitar e imprimir"}</button> : <button onClick={() => advance(ticket, "preparing")}>Aceitar pedido</button>)}
            {status === "preparing" && <button onClick={() => advance(ticket, "ready")}>Marcar como pronto</button>}
            {status === "ready" && <div className="kitchen-waiter-pickup"><b>{detail.fulfillment === "delivery" ? "Pronto para despacho" : "Pronto"}</b><span>{detail.fulfillment === "delivery" ? "Cozinha concluída. Aguardando a fila de motoboys." : detail.fulfillment === "dine_in" ? "Aguardando retirada do garçom." : "Aguardando retirada do cliente."}</span></div>}
            {status === "ready" && detail.fulfillment !== "delivery" && canReturnToAdmin && <button onClick={() => void advance(ticket, "delivered")}>Marcar entregue</button>}
            {status === "delivered" && <div className="kitchen-delivery-owner"><small>RETIRADO POR</small><b>{ticket.delivered_by_name || "Equipe"}</b></div>}
            {canPrint && status !== "received" && <button className="print-ticket" onClick={() => void printOne(ticket)}>Reimprimir</button>}
          </footer>
        </article>;
      })}</div>
    </div>)}</section>
    <KitchenHistory establishmentId={establishmentId} />
    {message && <div className="form-message sticky-message">{message}</div>}
  </main>;
}
