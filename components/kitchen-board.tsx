"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { subscribeToPush, supportsPushNotifications } from "@/lib/push-notifications";
import { getCurrentOperatingWindow, isDateInOperatingWindow, type BusinessHour } from "@/lib/business-hours";

type Ticket = { id: string; table_order_id?: string | null; public_order_id?: string | null; status: string; created_at: string; delivered_at?: string | null; delivered_by_name?: string | null };
type TableOrder = { id: string; table_session_id: string; order_number: number; notes?: string | null };
type PublicOrder = { id: string; order_number: number; notes?: string | null; customer_name: string; fulfillment_type: string; restaurant_table_id?: string | null; payment_method?: string | null };
type TableItem = { id: string; table_order_id: string; product_name: string; quantity: number; notes?: string | null; addons: { name: string }[]; removed_ingredients: string[] };
type PublicItem = { id: string; order_id: string; product_name: string; quantity: number; notes?: string | null; addons: { name: string }[]; removed_ingredients: string[] };
type Initial = { tickets: Ticket[]; tableOrders: TableOrder[]; publicOrders: PublicOrder[]; sessions: { id: string; table_id: string; customer_name?: string | null }[]; tables: { id: string; table_number: string; table_name?: string | null }[]; tableItems: TableItem[]; publicItems: PublicItem[] };
type DirectPrinter = { configured: boolean; online: boolean; printer_name?: string | null };
const columns = [["received", "Novos pedidos"], ["preparing", "Em preparo"], ["ready", "Prontos"], ["delivered", "Entregues"]];
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);

export function KitchenBoard({ establishmentId, establishmentName, operatorName, canReturnToAdmin, canPrint, autoPrint, paperWidth, directPrinter, businessHours, initial }: { establishmentId: string; establishmentName: string; operatorName: string; canReturnToAdmin: boolean; canPrint: boolean; autoPrint: boolean; paperWidth: 58 | 80; directPrinter: DirectPrinter; businessHours: BusinessHour[]; initial: Initial }) {
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [message, setMessage] = useState("");
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [pushStatus, setPushStatus] = useState<"unsupported" | "idle" | "active">("idle");
  const [printerStatus, setPrinterStatus] = useState<DirectPrinter>(directPrinter);
  const [operatingHours, setOperatingHours] = useState<BusinessHour[]>(businessHours);

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
    if (!supportsPushNotifications()) { setPushStatus("unsupported"); return; }
    const subscription = await subscribeToPush(askPermission).catch(() => null);
    if (!subscription) { setPushStatus("idle"); return; }
    const { error } = await supabase.rpc("register_kitchen_push_subscription", { requested_establishment_id: establishmentId, requested_subscription: subscription });
    if (error) setMessage(error.message); else setPushStatus("active");
  }

  async function refresh(withAlert = false, insertedId?: string) {
    const [{ data: tickets }, { data: tableOrders }, { data: publicOrders }, { data: sessions }, { data: tables }, { data: tableItems }, { data: publicItems }] = await Promise.all([
      supabase.from("kitchen_tickets").select("*").eq("establishment_id", establishmentId).neq("status", "canceled").order("created_at"),
      supabase.from("table_orders").select("id,table_session_id,order_number,notes").eq("establishment_id", establishmentId),
      supabase.from("orders").select("id,order_number,notes,customer_name,fulfillment_type,restaurant_table_id,payment_method").eq("establishment_id", establishmentId),
      supabase.from("table_sessions").select("id,table_id,customer_name").eq("establishment_id", establishmentId),
      supabase.from("restaurant_tables").select("id,table_number,table_name").eq("establishment_id", establishmentId),
      supabase.from("table_order_items").select("id,table_order_id,product_name,quantity,notes,addons,removed_ingredients").eq("establishment_id", establishmentId),
      supabase.from("order_items").select("id,order_id,product_name,quantity,notes,addons,removed_ingredients").eq("establishment_id", establishmentId),
    ]);
    const nextData = tickets && tableOrders && publicOrders && sessions && tables && tableItems && publicItems ? { tickets, tableOrders, publicOrders, sessions, tables, tableItems, publicItems } as Initial : null;
    if (nextData) setData(nextData);
    if (withAlert) {
      try {
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.connect(gain); gain.connect(context.destination);
        oscillator.frequency.value = 880; gain.gain.value = .08;
        oscillator.start(); oscillator.stop(context.currentTime + .22);
      } catch {}
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
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    const clearPrint = () => setPrintingId(null);
    window.addEventListener("afterprint", clearPrint);
    const channel = supabase.channel(`kitchen-${establishmentId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "kitchen_tickets", filter: `establishment_id=eq.${establishmentId}` }, payload => { void refresh(true, String(payload.new.id)); })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "kitchen_tickets", filter: `establishment_id=eq.${establishmentId}` }, () => { void refresh(); })
      .subscribe();
    return () => { clearInterval(timer); window.removeEventListener("afterprint", clearPrint); void supabase.removeChannel(channel); };
  }, [establishmentId, supabase, autoPrint, canPrint, printerStatus.configured, printerStatus.online, printerStatus.printer_name]);

  async function advance(ticket: Ticket, status: string) {
    const { error } = await supabase.rpc("update_kitchen_ticket", { requested_ticket_id: ticket.id, requested_status: status });
    if (error) setMessage(error.message); else await refresh();
  }

  function details(ticket: Ticket, source = data) {
    if (ticket.public_order_id) {
      const order = source.publicOrders.find(value => value.id === ticket.public_order_id);
      const table = source.tables.find(value => value.id === order?.restaurant_table_id);
      return { number: order?.order_number, notes: order?.notes, customer: order?.customer_name, table, payment: order?.payment_method, items: source.publicItems.filter(value => value.order_id === order?.id) };
    }
    const order = source.tableOrders.find(value => value.id === ticket.table_order_id);
    const session = source.sessions.find(value => value.id === order?.table_session_id);
    const table = source.tables.find(value => value.id === session?.table_id);
    return { number: order?.order_number, notes: order?.notes, customer: session?.customer_name, table, payment: null, items: source.tableItems.filter(value => value.table_order_id === order?.id) };
  }

  function receiptText(ticket: Ticket, source = data) {
    const detail = details(ticket, source);
    const width = paperWidth === 80 ? 48 : 32;
    const line = "-".repeat(width);
    const center = (value: string) => value.slice(0, width).padStart(Math.floor((width + value.slice(0, width).length) / 2)).padEnd(width);
    const rows = [center(establishmentName.toUpperCase()), center(`PEDIDO #${detail.number ?? "-"}`), line];
    rows.push(`ATENDIMENTO: ${detail.table?.table_number ? `MESA ${detail.table.table_number}` : "BALCAO"}`);
    if (detail.customer) rows.push(`CLIENTE: ${detail.customer}`);
    if (detail.table?.table_name) rows.push(`LOCAL: ${detail.table.table_name}`);
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
    frame.srcdoc = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Pedido #${escapeHtml(detail.number)}</title><style>@page{size:${paperWidth}mm 260mm;margin:2mm}*{box-sizing:border-box}html,body{background:#fff;color:#000;margin:0;padding:0}body{width:${paperWidth - 4}mm;font:12px/1.4 monospace}header{text-align:center}h1{font-size:16px;margin:0 0 5px}h2{font-size:22px;margin:8px 0}.line{border-top:1px dashed #000;margin:10px 0}.meta{text-align:center}.meta b,.meta span{display:block}.meta b{font-size:9px;text-transform:uppercase}.item{border-bottom:1px dashed #000;padding:9px 0}.item>b{font-size:14px}.item span,.item em{display:block;font-size:11px;margin-top:3px}.item em{font-style:normal}.item strong{border:2px solid #000;display:block;font-size:16px;margin-top:5px;padding:5px;text-align:center}.notes{border:2px solid #000;font-size:13px;font-weight:bold;margin-top:10px;padding:7px}.payment{font-size:12px;font-weight:bold;margin-top:10px;text-align:center}.footer{font-size:9px;margin-top:12px;text-align:center}</style></head><body><header><h1>${escapeHtml(establishmentName)}</h1><h2>PEDIDO #${escapeHtml(detail.number ?? "—")}</h2></header><div class="line"></div><div class="meta"><p><b>Atendimento</b><span>${escapeHtml(detail.table?.table_number ? `Mesa ${detail.table.table_number}` : "Balcão")}</span></p>${detail.customer ? `<p><b>Cliente</b><span>${escapeHtml(detail.customer)}</span></p>` : ""}${detail.table?.table_name ? `<p><b>Local</b><span>${escapeHtml(detail.table.table_name)}</span></p>` : ""}</div><div class="line"></div>${items}${detail.notes ? `<div class="notes">OBSERVAÇÃO: ${escapeHtml(detail.notes)}</div>` : ""}${detail.payment ? `<div class="payment">PAGAMENTO: ${escapeHtml(detail.payment).toUpperCase()}</div>` : ""}<div class="footer">${new Date(ticket.created_at).toLocaleString("pt-BR")}</div></body></html>`;
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
  const visibleTickets = data.tickets.filter(ticket => ticket.status !== "delivered" || isDateInOperatingWindow(ticket.delivered_at, operatingWindow));
  const visibleColumns = columns.filter(([status]) => status !== "delivered" || !operatingWindow.configured || operatingWindow.isOpen);

  return <main className={`kitchen-page ${printingId ? "printing-one" : ""}`} style={{ "--ticket-width": `${paperWidth}mm` } as React.CSSProperties}>
    <header className="kitchen-head"><div><small>COZINHA · TEMPO REAL</small><h1>{establishmentName}</h1><p>Operador: <b>{operatorName}</b></p>{printerStatus.configured && <p className={`direct-printer-status ${printerStatus.online ? "online" : "offline"}`}><i /> {printerStatus.online ? `Impressora conectada: ${printerStatus.printer_name}` : "Impressora aguardando o computador"}</p>}{operatingWindow.configured && !operatingWindow.isOpen && <p className="kitchen-closed-note">Expediente encerrado · entregues arquivados em Pedidos semanais</p>}</div><div><span>{visibleTickets.filter(value => value.status !== "delivered").length} comandas ativas</span><div className="kitchen-head-actions">{canReturnToAdmin && <Link className="kitchen-admin-return" href="/painel">← Voltar ao painel administrativo</Link>}{canReturnToAdmin && <Link className="kitchen-admin-return kitchen-register-return" href="/painel/configuracoes#equipe-cozinha">+ Cadastrar responsável</Link>}{pushStatus !== "unsupported" && <button className={`kitchen-notification-button ${pushStatus === "active" ? "active" : ""}`} onClick={() => void enablePushNotifications(true)}>{pushStatus === "active" ? "Alertas ativos" : "Ativar alertas"}</button>}</div><Link href="/cozinha/login">Trocar operador</Link></div></header>
    <section className={`kitchen-columns columns-${visibleColumns.length}`}>{visibleColumns.map(([status, title]) => <div className={`kitchen-column column-${status}`} key={status}>
      <header><h2>{title}</h2><b>{visibleTickets.filter(value => value.status === status).length}</b></header>
      <div>{visibleTickets.filter(value => value.status === status).map(ticket => {
        const detail = details(ticket);
        const minutes = Math.max(0, Math.floor((now - new Date(ticket.created_at).getTime()) / 60000));
        return <article className={`kitchen-ticket ${printingId === ticket.id ? "print-target" : ""}`} key={ticket.id}>
          <div className="ticket-top"><div><small>PEDIDO</small><strong>#{detail.number || "—"}</strong></div><div><small>MESA</small><strong>{detail.table?.table_number || "BALCÃO"}</strong></div><time>{minutes} min</time></div>
          {detail.customer && <div className="ticket-customer"><small>CLIENTE</small><b>{detail.customer}</b>{detail.table?.table_name && <span>{detail.table.table_name}</span>}</div>}
          <div className="ticket-items">{detail.items.map(item => <div key={item.id}>
            <b>{item.quantity}× {item.product_name}</b>
            {item.addons?.length > 0 && <span>+ {item.addons.map(addon => addon.name).join(", ")}</span>}
            {item.removed_ingredients?.length > 0 && <strong className="ticket-removed-alert">SEM: {item.removed_ingredients.join(", ")}</strong>}
            {item.notes && <em>{item.notes}</em>}
          </div>)}</div>
          {detail.notes && <p><b>Observação:</b> {detail.notes}</p>}
          {detail.payment && <small>PAGAMENTO: {detail.payment}</small>}
          <footer>
            {status === "received" && (canPrint ? <button onClick={() => void printOne(ticket)}>{printerStatus.configured ? "Aceitar e imprimir direto" : "Aceitar e imprimir"}</button> : <button onClick={() => advance(ticket, "preparing")}>Aceitar pedido</button>)}
            {status === "preparing" && <button onClick={() => advance(ticket, "ready")}>Marcar como pronto</button>}
            {status === "ready" && <div className="kitchen-waiter-pickup"><b>Pronto</b><span>Aguardando retirada do garçom.</span></div>}
            {status === "delivered" && <div className="kitchen-delivery-owner"><small>RETIRADO POR</small><b>{ticket.delivered_by_name || "Equipe"}</b></div>}
            {canPrint && status !== "received" && <button className="print-ticket" onClick={() => void printOne(ticket)}>Reimprimir</button>}
          </footer>
        </article>;
      })}</div>
    </div>)}</section>
    {message && <div className="form-message sticky-message">{message}</div>}
  </main>;
}
