"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Ticket = {
  id: string;
  table_order_id: string;
  status: string;
  created_at: string;
  updated_at?: string | null;
  started_at?: string | null;
  ready_at?: string | null;
  delivered_at?: string | null;
};
type Order = { id: string; table_session_id: string; order_number: number; created_at: string };
type Session = { id: string; table_id: string };
type Table = { id: string; table_number: string };
export type WaiterTrackingData = { tickets: Ticket[]; orders: Order[]; sessions: Session[]; tables: Table[] };

const stages = [
  { status: "received", label: "Novos pedidos", action: "Aguardando cozinha" },
  { status: "preparing", label: "Em preparo", action: "Sendo preparado" },
  { status: "ready", label: "Prontos", action: "Retirar agora" },
  { status: "delivered", label: "Entregues", action: "Entrega concluída" },
];

function elapsed(now: number, timestamp?: string | null) {
  if (!timestamp) return "agora";
  const totalSeconds = Math.max(0, Math.floor((now - new Date(timestamp).getTime()) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}min`;
}

export function WaiterOrderTracker({ establishmentId, initial }: {
  establishmentId: string;
  initial: WaiterTrackingData;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [message, setMessage] = useState("");
  const [busyTicket, setBusyTicket] = useState<string | null>(null);

  async function refresh(readyAlert = false) {
    const [{ data: tickets }, { data: orders }, { data: sessions }, { data: tables }] = await Promise.all([
      supabase.from("kitchen_tickets").select("*").eq("establishment_id", establishmentId).neq("status", "canceled").order("created_at", { ascending: false }).limit(100),
      supabase.from("table_orders").select("id,table_session_id,order_number,created_at").eq("establishment_id", establishmentId).order("created_at", { ascending: false }).limit(100),
      supabase.from("table_sessions").select("id,table_id").eq("establishment_id", establishmentId),
      supabase.from("restaurant_tables").select("id,table_number").eq("establishment_id", establishmentId),
    ]);
    if (tickets && orders && sessions && tables) {
      setData({ tickets, orders, sessions, tables } as WaiterTrackingData);
      if (readyAlert) {
        const readyTicket = tickets.find(ticket => ticket.status === "ready");
        const details = readyTicket ? ticketDetails(readyTicket, { tickets, orders, sessions, tables } as WaiterTrackingData) : null;
        setMessage(`Pedido pronto${details?.table ? ` na mesa ${details.table.table_number}` : ""}. Retire agora na cozinha.`);
        navigator.vibrate?.([250, 120, 250]);
        try {
          const context = new AudioContext();
          const gain = context.createGain();
          gain.connect(context.destination);
          gain.gain.value = 0.12;
          [880, 1175].forEach((frequency, index) => {
            const oscillator = context.createOscillator();
            oscillator.connect(gain);
            oscillator.frequency.value = frequency;
            oscillator.start(context.currentTime + index * 0.22);
            oscillator.stop(context.currentTime + index * 0.22 + 0.18);
          });
        } catch { /* Alguns celulares exigem interação antes de liberar áudio. */ }
      }
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const channel = supabase.channel(`waiter-kitchen-tracker-${establishmentId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "kitchen_tickets", filter: `establishment_id=eq.${establishmentId}` }, payload => {
        const nextStatus = (payload.new as { status?: string } | null)?.status;
        void refresh(nextStatus === "ready");
      })
      .subscribe();
    return () => { window.clearInterval(timer); void supabase.removeChannel(channel); };
  }, [establishmentId, supabase]);

  function ticketDetails(ticket: Ticket, source = data) {
    const order = source.orders.find(value => value.id === ticket.table_order_id);
    const session = source.sessions.find(value => value.id === order?.table_session_id);
    const table = source.tables.find(value => value.id === session?.table_id);
    return { order, table };
  }

  function stageStartedAt(ticket: Ticket) {
    if (ticket.status === "preparing") return ticket.started_at || ticket.updated_at || ticket.created_at;
    if (ticket.status === "ready") return ticket.ready_at || ticket.updated_at || ticket.created_at;
    if (ticket.status === "delivered") return ticket.delivered_at || ticket.updated_at || ticket.created_at;
    return ticket.created_at;
  }

  async function collect(ticket: Ticket) {
    setBusyTicket(ticket.id);
    const { error } = await supabase.rpc("update_kitchen_ticket", {
      requested_ticket_id: ticket.id,
      requested_status: "delivered",
    });
    if (error) setMessage(error.message);
    else {
      setMessage("Pedido retirado e marcado como entregue automaticamente.");
      await refresh();
    }
    setBusyTicket(null);
  }

  const readyTickets = data.tickets.filter(ticket => ticket.status === "ready");

  return <section className="waiter-tracker" aria-label="Acompanhamento dos pedidos">
    <header>
      <div><small>ACOMPANHAMENTO EM TEMPO REAL</small><h2>Pedidos do salão.</h2><p>Veja o tempo em cada etapa e retire os pedidos prontos sem demora.</p></div>
      <span>{data.tickets.filter(ticket => ticket.status !== "delivered").length} ativos</span>
    </header>

    {readyTickets.length > 0 && <div className="ready-pickup-alert" role="alert">
      <span className="ready-alert-icon">!</span>
      <div><b>{readyTickets.length === 1 ? "Pedido pronto para retirada" : `${readyTickets.length} pedidos prontos para retirada`}</b><small>A cozinha está aguardando o garçom.</small></div>
    </div>}

    <div className="waiter-stage-grid">
      {stages.map(stage => {
        const tickets = data.tickets.filter(ticket => ticket.status === stage.status);
        return <div className={`waiter-stage stage-${stage.status}`} key={stage.status}>
          <header><div><small>{stage.action}</small><h3>{stage.label}</h3></div><b>{tickets.length}</b></header>
          <div className="waiter-stage-list">
            {tickets.map(ticket => {
              const { order, table } = ticketDetails(ticket);
              return <article key={ticket.id}>
                <div><small>MESA</small><strong>{table?.table_number || "—"}</strong></div>
                <div><small>PEDIDO</small><b>#{order?.order_number || "—"}</b></div>
                <time><span>Nesta etapa</span><b>{elapsed(now, stageStartedAt(ticket))}</b><small>Total {elapsed(now, ticket.created_at)}</small></time>
                {ticket.status === "ready" && <button disabled={busyTicket === ticket.id} onClick={() => collect(ticket)}>
                  {busyTicket === ticket.id ? "Registrando..." : "Retirar pedido"}
                </button>}
              </article>;
            })}
            {!tickets.length && <div className="empty-stage">Nenhum pedido.</div>}
          </div>
        </div>;
      })}
    </div>
    {message && <div className={message.includes("pronto") ? "tracker-message ready" : "tracker-message"}>{message}</div>}
  </section>;
}
