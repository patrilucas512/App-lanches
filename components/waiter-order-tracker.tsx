"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { subscribeToPush, supportsPushNotifications } from "@/lib/push-notifications";

type Ticket = {
  id: string;
  table_order_id?: string | null;
  public_order_id?: string | null;
  status: string;
  created_at: string;
  updated_at?: string | null;
  started_at?: string | null;
  ready_at?: string | null;
  delivered_at?: string | null;
  delivered_by_name?: string | null;
};
type Order = { id: string; table_session_id: string; order_number: number; created_at: string };
type PublicOrder = { id: string; restaurant_table_id?: string | null; order_number: number; fulfillment_type: string; created_at: string };
type Session = { id: string; table_id: string };
type Table = { id: string; table_number: string };
export type WaiterTrackingData = { tickets: Ticket[]; orders: Order[]; publicOrders: PublicOrder[]; sessions: Session[]; tables: Table[] };

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

export function WaiterOrderTracker({ establishmentId, initial }: { establishmentId: string; initial: WaiterTrackingData }) {
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [message, setMessage] = useState("");
  const [busyTicket, setBusyTicket] = useState<string | null>(null);
  const [pushStatus, setPushStatus] = useState<"unsupported" | "idle" | "active">("idle");

  function isWaiterTicket(ticket: Ticket, source = data) {
    if (ticket.table_order_id) return source.orders.some(order => order.id === ticket.table_order_id);
    if (!ticket.public_order_id) return false;
    const order = source.publicOrders.find(value => value.id === ticket.public_order_id);
    return order?.fulfillment_type === "dine_in";
  }

  function ticketDetails(ticket: Ticket, source = data) {
    if (ticket.public_order_id) {
      const order = source.publicOrders.find(value => value.id === ticket.public_order_id);
      const table = source.tables.find(value => value.id === order?.restaurant_table_id);
      return { orderNumber: order?.order_number, table };
    }
    const order = source.orders.find(value => value.id === ticket.table_order_id);
    const session = source.sessions.find(value => value.id === order?.table_session_id);
    const table = source.tables.find(value => value.id === session?.table_id);
    return { orderNumber: order?.order_number, table };
  }

  function signalAlert(ticket: Ticket, status: string, source: WaiterTrackingData) {
    const details = ticketDetails(ticket, source);
    const ready = status === "ready";
    const title = ready ? "Pedido pronto para retirada" : "Novo pedido do salão";
    const body = `${details.table?.table_number ? `Mesa ${details.table.table_number}` : "Mesa"} · Pedido #${details.orderNumber || "—"}`;
    setMessage(`${title}. ${body}.`);
    navigator.vibrate?.(ready ? [350, 140, 350, 140, 350] : [220, 100, 220]);
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body, tag: `waiter-${status}-${ticket.id}` });
    }
    try {
      const context = new AudioContext();
      const gain = context.createGain();
      gain.connect(context.destination);
      gain.gain.value = ready ? 0.16 : 0.1;
      const frequencies = ready ? [880, 1175, 880] : [880, 1175];
      frequencies.forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        oscillator.connect(gain);
        oscillator.frequency.value = frequency;
        oscillator.start(context.currentTime + index * 0.24);
        oscillator.stop(context.currentTime + index * 0.24 + 0.2);
      });
    } catch { /* O push continua funcionando quando o navegador restringe áudio automático. */ }
  }

  async function enablePushNotifications(askPermission = true) {
    if (!supportsPushNotifications()) { setPushStatus("unsupported"); return; }
    const subscription = await subscribeToPush(askPermission).catch(() => null);
    if (!subscription) { setPushStatus("idle"); return; }
    const { error } = await supabase.rpc("register_waiter_push_subscription", {
      requested_establishment_id: establishmentId,
      requested_subscription: subscription,
    });
    if (error) setMessage(error.message); else { setPushStatus("active"); setMessage("Alertas do garçom ativados neste aparelho."); }
  }

  async function refresh(alertTicketId?: string, alertStatus?: string) {
    const [{ data: tickets }, { data: orders }, { data: publicOrders }, { data: sessions }, { data: tables }] = await Promise.all([
      supabase.from("kitchen_tickets").select("*").eq("establishment_id", establishmentId).neq("status", "canceled").order("created_at", { ascending: false }).limit(100),
      supabase.from("table_orders").select("id,table_session_id,order_number,created_at").eq("establishment_id", establishmentId).order("created_at", { ascending: false }).limit(100),
      supabase.from("orders").select("id,restaurant_table_id,order_number,fulfillment_type,created_at").eq("establishment_id", establishmentId).order("created_at", { ascending: false }).limit(100),
      supabase.from("table_sessions").select("id,table_id").eq("establishment_id", establishmentId),
      supabase.from("restaurant_tables").select("id,table_number").eq("establishment_id", establishmentId),
    ]);
    if (!tickets || !orders || !publicOrders || !sessions || !tables) return;
    const next = { tickets, orders, publicOrders, sessions, tables } as WaiterTrackingData;
    setData(next);
    const target = alertTicketId ? next.tickets.find(ticket => ticket.id === alertTicketId) : null;
    if (target && alertStatus && isWaiterTicket(target, next)) signalAlert(target, alertStatus, next);
  }

  useEffect(() => {
    const resumePush = window.setTimeout(() => {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") void enablePushNotifications(false);
    }, 0);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const channel = supabase.channel(`waiter-kitchen-tracker-${establishmentId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "kitchen_tickets", filter: `establishment_id=eq.${establishmentId}` }, payload => {
        const next = payload.new as { id?: string; status?: string } | null;
        const shouldAlert = next?.status === "received" || next?.status === "ready";
        void refresh(shouldAlert ? String(next?.id) : undefined, shouldAlert ? String(next?.status) : undefined);
      })
      .subscribe();
    return () => { window.clearTimeout(resumePush); window.clearInterval(timer); void supabase.removeChannel(channel); };
  }, [establishmentId, supabase]);

  function stageStartedAt(ticket: Ticket) {
    if (ticket.status === "preparing") return ticket.started_at || ticket.updated_at || ticket.created_at;
    if (ticket.status === "ready") return ticket.ready_at || ticket.updated_at || ticket.created_at;
    if (ticket.status === "delivered") return ticket.delivered_at || ticket.updated_at || ticket.created_at;
    return ticket.created_at;
  }

  async function collect(ticket: Ticket) {
    setBusyTicket(ticket.id);
    const { error } = await supabase.rpc("update_kitchen_ticket", { requested_ticket_id: ticket.id, requested_status: "delivered" });
    if (error) setMessage(error.message);
    else { setMessage("Pedido retirado e identificado como entregue por você."); await refresh(); }
    setBusyTicket(null);
  }

  const visibleTickets = data.tickets.filter(ticket => isWaiterTicket(ticket));
  const readyTickets = visibleTickets.filter(ticket => ticket.status === "ready");

  return <section className="waiter-tracker" aria-label="Acompanhamento dos pedidos do salão">
    <header>
      <div><small>ACOMPANHAMENTO EM TEMPO REAL</small><h2>Pedidos do salão.</h2><p>Retirada no balcão não aparece aqui. Somente pedidos que precisam da equipe de garçons.</p></div>
      <div className="waiter-alert-controls"><span>{visibleTickets.filter(ticket => ticket.status !== "delivered").length} ativos</span>{pushStatus !== "unsupported" && <button type="button" className={pushStatus === "active" ? "active" : ""} onClick={() => void enablePushNotifications(true)}>{pushStatus === "active" ? "Alertas ativos" : "Ativar alertas"}</button>}</div>
    </header>

    {readyTickets.length > 0 && <div className="ready-pickup-alert" role="alert"><span className="ready-alert-icon">!</span><div><b>{readyTickets.length === 1 ? "Pedido pronto para retirada" : `${readyTickets.length} pedidos prontos para retirada`}</b><small>A cozinha está aguardando o garçom.</small></div></div>}

    <div className="waiter-stage-grid">
      {stages.map(stage => {
        const tickets = visibleTickets.filter(ticket => ticket.status === stage.status);
        return <div className={`waiter-stage stage-${stage.status}`} key={stage.status}>
          <header><div><small>{stage.action}</small><h3>{stage.label}</h3></div><b>{tickets.length}</b></header>
          <div className="waiter-stage-list">
            {tickets.map(ticket => {
              const details = ticketDetails(ticket);
              return <article key={ticket.id}>
                <div><small>MESA</small><strong>{details.table?.table_number || "—"}</strong></div>
                <div><small>PEDIDO</small><b>#{details.orderNumber || "—"}</b></div>
                <time><span>Nesta etapa</span><b>{elapsed(now, stageStartedAt(ticket))}</b><small>Total {elapsed(now, ticket.created_at)}</small></time>
                {ticket.status === "ready" && <button disabled={busyTicket === ticket.id} onClick={() => collect(ticket)}>{busyTicket === ticket.id ? "Registrando..." : "Retirar pedido"}</button>}
                {ticket.status === "delivered" && <div className="delivery-owner"><small>RETIRADO E ENTREGUE POR</small><b>{ticket.delivered_by_name || "Equipe"}</b></div>}
              </article>;
            })}
            {!tickets.length && <div className="empty-stage">Nenhum pedido.</div>}
          </div>
        </div>;
      })}
    </div>
    {message && <div className={message.includes("pronto") || message.includes("ativados") ? "tracker-message ready" : "tracker-message"}>{message}</div>}
  </section>;
}
