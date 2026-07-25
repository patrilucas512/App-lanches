"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Ticket = { id: string; table_order_id: string; status: string; created_at: string };
type Order = { id: string; table_session_id: string; order_number: number; notes?: string; created_at: string };
type Item = { id: string; table_order_id: string; product_name: string; quantity: number; notes?: string; addons: { name: string }[]; removed_ingredients: string[] };
type Initial = { tickets: Ticket[]; orders: Order[]; sessions: { id: string; table_id: string }[]; tables: { id: string; table_number: string; table_name?: string }[]; items: Item[] };
const columns = [["received", "Novos pedidos"], ["preparing", "Em preparo"], ["ready", "Prontos"], ["delivered", "Entregues"]];

export function KitchenBoard({ establishmentId, establishmentName, initial }: { establishmentId: string; establishmentName: string; initial: Initial }) {
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [message, setMessage] = useState("");
  async function refresh(withAlert = false) {
    const [{ data: tickets }, { data: orders }, { data: sessions }, { data: tables }, { data: items }] = await Promise.all([
      supabase.from("kitchen_tickets").select("*").eq("establishment_id", establishmentId).neq("status", "canceled").order("created_at"),
      supabase.from("table_orders").select("*").eq("establishment_id", establishmentId).order("created_at"),
      supabase.from("table_sessions").select("id,table_id").eq("establishment_id", establishmentId),
      supabase.from("restaurant_tables").select("id,table_number,table_name").eq("establishment_id", establishmentId),
      supabase.from("table_order_items").select("*").eq("establishment_id", establishmentId).order("created_at"),
    ]);
    if (tickets && orders && sessions && tables && items) {
      setData({ tickets, orders, sessions, tables, items } as Initial);
      if (withAlert) {
        try {
          const context = new AudioContext(); const oscillator = context.createOscillator(); const gain = context.createGain();
          oscillator.connect(gain); gain.connect(context.destination); oscillator.frequency.value = 880; gain.gain.value = .08;
          oscillator.start(); oscillator.stop(context.currentTime + .22);
        } catch { /* navegador pode exigir interação */ }
      }
    }
  }
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    const channel = supabase.channel(`kitchen-${establishmentId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "kitchen_tickets", filter: `establishment_id=eq.${establishmentId}` }, () => { void refresh(true); })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "kitchen_tickets", filter: `establishment_id=eq.${establishmentId}` }, () => { void refresh(); })
      .subscribe();
    return () => { clearInterval(timer); void supabase.removeChannel(channel); };
  }, [establishmentId, supabase]);
  async function advance(ticket: Ticket, status: string) {
    const { error } = await supabase.rpc("update_kitchen_ticket", { requested_ticket_id: ticket.id, requested_status: status });
    if (error) setMessage(error.message); else await refresh();
  }
  function details(ticket: Ticket) {
    const order = data.orders.find(value => value.id === ticket.table_order_id);
    const session = data.sessions.find(value => value.id === order?.table_session_id);
    const table = data.tables.find(value => value.id === session?.table_id);
    return { order, table, items: data.items.filter(value => value.table_order_id === order?.id) };
  }
  return <main className="kitchen-page">
    <header className="kitchen-head"><div><small>COZINHA · TEMPO REAL</small><h1>{establishmentName}</h1></div><div><span>{data.tickets.filter(value => value.status !== "delivered").length} comandas ativas</span><Link href="/painel/garcom">Área do garçom</Link></div></header>
    <section className="kitchen-columns">{columns.map(([status, title]) => <div className={`kitchen-column column-${status}`} key={status}><header><h2>{title}</h2><b>{data.tickets.filter(value => value.status === status).length}</b></header><div>{data.tickets.filter(value => value.status === status).map(ticket => {
      const { order, table, items } = details(ticket); const minutes = Math.max(0, Math.floor((now - new Date(ticket.created_at).getTime()) / 60000));
      return <article className="kitchen-ticket" key={ticket.id}><div className="ticket-top"><div><small>COMANDA</small><strong>#{order?.order_number || "—"}</strong></div><div><small>MESA</small><strong>{table?.table_number || "—"}</strong></div><time>{minutes} min</time></div><div className="ticket-items">{items.map(item => <div key={item.id}><b>{item.quantity}× {item.product_name}</b>{item.addons?.length > 0 && <span>+ {item.addons.map(addon => addon.name).join(", ")}</span>}{item.removed_ingredients?.length > 0 && <span>SEM: {item.removed_ingredients.join(", ")}</span>}{item.notes && <em>{item.notes}</em>}</div>)}</div>{order?.notes && <p>{order.notes}</p>}<footer>{status === "received" && <button onClick={() => advance(ticket, "preparing")}>Iniciar preparo</button>}{status === "preparing" && <button onClick={() => advance(ticket, "ready")}>Marcar como pronto</button>}{status === "ready" && <div className="kitchen-waiter-pickup"><b>Pronto</b><span>Aguardando retirada do garçom.</span></div>}<button className="print-ticket" onClick={() => window.print()}>Imprimir</button></footer></article>;
    })}</div></div>)}</section>
    {message && <div className="form-message sticky-message">{message}</div>}
  </main>;
}
