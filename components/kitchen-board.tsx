"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Ticket = { id: string; table_order_id?: string | null; public_order_id?: string | null; status: string; created_at: string; delivered_by_name?: string | null };
type TableOrder = { id: string; table_session_id: string; order_number: number; notes?: string | null };
type PublicOrder = { id: string; order_number: number; notes?: string | null; customer_name: string; fulfillment_type: string; restaurant_table_id?: string | null; payment_method?: string | null };
type TableItem = { id: string; table_order_id: string; product_name: string; quantity: number; notes?: string | null; addons: { name: string }[]; removed_ingredients: string[] };
type PublicItem = { id: string; order_id: string; product_name: string; quantity: number; notes?: string | null; addons: { name: string }[]; removed_ingredients: string[] };
type Initial = { tickets: Ticket[]; tableOrders: TableOrder[]; publicOrders: PublicOrder[]; sessions: { id: string; table_id: string; customer_name?: string | null }[]; tables: { id: string; table_number: string; table_name?: string | null }[]; tableItems: TableItem[]; publicItems: PublicItem[] };
const columns = [["received", "Novos pedidos"], ["preparing", "Em preparo"], ["ready", "Prontos"], ["delivered", "Entregues"]];

export function KitchenBoard({ establishmentId, establishmentName, autoPrint, initial }: { establishmentId: string; establishmentName: string; autoPrint: boolean; initial: Initial }) {
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [message, setMessage] = useState("");
  const [printingId, setPrintingId] = useState<string | null>(null);

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
    if (tickets && tableOrders && publicOrders && sessions && tables && tableItems && publicItems) setData({ tickets, tableOrders, publicOrders, sessions, tables, tableItems, publicItems } as Initial);
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
    if (autoPrint && insertedId) {
      const inserted = tickets?.find(ticket => ticket.id === insertedId);
      if (inserted?.status === "received") await supabase.rpc("update_kitchen_ticket", { requested_ticket_id: insertedId, requested_status: "preparing" });
      setPrintingId(insertedId);
      window.setTimeout(() => window.print(), 450);
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    const clearPrint = () => setPrintingId(null);
    window.addEventListener("afterprint", clearPrint);
    const channel = supabase.channel(`kitchen-${establishmentId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "kitchen_tickets", filter: `establishment_id=eq.${establishmentId}` }, payload => { void refresh(true, String(payload.new.id)); })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "kitchen_tickets", filter: `establishment_id=eq.${establishmentId}` }, () => { void refresh(); })
      .subscribe();
    return () => { clearInterval(timer); window.removeEventListener("afterprint", clearPrint); void supabase.removeChannel(channel); };
  }, [establishmentId, supabase, autoPrint]);

  async function advance(ticket: Ticket, status: string) {
    const { error } = await supabase.rpc("update_kitchen_ticket", { requested_ticket_id: ticket.id, requested_status: status });
    if (error) setMessage(error.message); else await refresh();
  }

  function details(ticket: Ticket) {
    if (ticket.public_order_id) {
      const order = data.publicOrders.find(value => value.id === ticket.public_order_id);
      const table = data.tables.find(value => value.id === order?.restaurant_table_id);
      return { number: order?.order_number, notes: order?.notes, customer: order?.customer_name, table, payment: order?.payment_method, items: data.publicItems.filter(value => value.order_id === order?.id) };
    }
    const order = data.tableOrders.find(value => value.id === ticket.table_order_id);
    const session = data.sessions.find(value => value.id === order?.table_session_id);
    const table = data.tables.find(value => value.id === session?.table_id);
    return { number: order?.order_number, notes: order?.notes, customer: session?.customer_name, table, payment: null, items: data.tableItems.filter(value => value.table_order_id === order?.id) };
  }

  async function printOne(ticket: Ticket) {
    if (ticket.status === "received") {
      const { error } = await supabase.rpc("update_kitchen_ticket", { requested_ticket_id: ticket.id, requested_status: "preparing" });
      if (error) { setMessage(error.message); return; }
      await refresh();
    }
    setPrintingId(ticket.id);
    window.setTimeout(() => window.print(), 50);
  }

  return <main className={`kitchen-page ${printingId ? "printing-one" : ""}`}>
    <header className="kitchen-head"><div><small>COZINHA · TEMPO REAL</small><h1>{establishmentName}</h1></div><div><span>{data.tickets.filter(value => value.status !== "delivered").length} comandas ativas</span><Link href="/painel/garcom">Área do garçom</Link></div></header>
    <section className="kitchen-columns">{columns.map(([status, title]) => <div className={`kitchen-column column-${status}`} key={status}>
      <header><h2>{title}</h2><b>{data.tickets.filter(value => value.status === status).length}</b></header>
      <div>{data.tickets.filter(value => value.status === status).map(ticket => {
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
            {status === "received" && <button onClick={() => advance(ticket, "preparing")}>Iniciar preparo</button>}
            {status === "preparing" && <button onClick={() => advance(ticket, "ready")}>Marcar como pronto</button>}
            {status === "ready" && <div className="kitchen-waiter-pickup"><b>Pronto</b><span>Aguardando retirada do garçom.</span></div>}
            {status === "delivered" && <div className="kitchen-delivery-owner"><small>RETIRADO POR</small><b>{ticket.delivered_by_name || "Equipe"}</b></div>}
            <button className="print-ticket" onClick={() => void printOne(ticket)}>Imprimir</button>
          </footer>
        </article>;
      })}</div>
    </div>)}</section>
    {message && <div className="form-message sticky-message">{message}</div>}
  </main>;
}
