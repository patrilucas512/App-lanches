"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type WaiterCall = {
  id: string; establishment_id: string; table_id: string; status: "waiting" | "attended" | "canceled";
  customer_note?: string | null; created_at: string; attended_at?: string | null;
  restaurant_tables?: { table_number: string; table_name?: string | null; sector?: string | null }[] | null;
};
const statusLabel = { waiting: "Aguardando", attended: "Atendido", canceled: "Cancelado" };

export function WaiterCallsManager({ establishmentId, initialCalls }: { establishmentId: string; initialCalls: WaiterCall[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [calls, setCalls] = useState(initialCalls);
  const [filter, setFilter] = useState<"waiting" | "all">("waiting");
  const [now, setNow] = useState(Date.now());
  const [message, setMessage] = useState("");
  async function refresh() {
    const { data } = await supabase.from("waiter_calls")
      .select("id, establishment_id, table_id, status, customer_note, created_at, attended_at, restaurant_tables(table_number, table_name, sector)")
      .eq("establishment_id", establishmentId).order("created_at", { ascending: false }).limit(100);
    if (data) setCalls(data as unknown as WaiterCall[]);
  }
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    const channel = supabase.channel(`waiter-calls-${establishmentId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "waiter_calls", filter: `establishment_id=eq.${establishmentId}` }, () => { void refresh(); })
      .subscribe();
    return () => { clearInterval(timer); void supabase.removeChannel(channel); };
  }, [establishmentId, supabase]);
  async function setStatus(call: WaiterCall, status: "attended" | "canceled") {
    const { error } = await supabase.from("waiter_calls").update({
      status, attended_at: status === "attended" ? new Date().toISOString() : null,
    }).eq("id", call.id);
    if (error) return setMessage(error.message);
    setCalls(current => current.map(item => item.id === call.id ? { ...item, status, attended_at: status === "attended" ? new Date().toISOString() : null } : item));
  }
  const visible = filter === "waiting" ? calls.filter(call => call.status === "waiting") : calls;
  const waiting = calls.filter(call => call.status === "waiting").length;
  const waitText = (createdAt: string) => {
    const minutes = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 60000));
    return minutes < 1 ? "agora" : `${minutes} min`;
  };
  return <section className="panel waiter-panel">
    <div className="panel-title-row"><div><h2>{waiting} aguardando atendimento</h2><p>Novos chamados aparecem automaticamente nesta tela.</p></div><div className="call-filters"><button className={filter === "waiting" ? "active" : ""} onClick={() => setFilter("waiting")}>Aguardando</button><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>Histórico</button></div></div>
    {visible.length ? <div className="waiter-call-list">{visible.map(call => {
      const table = call.restaurant_tables?.[0];
      return <article className={`waiter-call ${call.status}`} key={call.id}>
        <div className="waiter-table"><small>{table?.sector || "MESA"}</small><strong>{table?.table_number || "—"}</strong><span>{table?.table_name}</span></div>
        <div className="waiter-details"><span className={`call-status ${call.status}`}>{statusLabel[call.status]}</span><h3>{call.customer_note || "Cliente solicitou atendimento."}</h3><p>{new Date(call.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · esperando {waitText(call.created_at)}</p></div>
        {call.status === "waiting" && <div className="waiter-actions"><button className="button dark" onClick={() => setStatus(call, "attended")}>Marcar como atendido</button><button className="button outline" onClick={() => setStatus(call, "canceled")}>Cancelar</button></div>}
      </article>;
    })}</div> : <div className="empty"><b>Nenhum chamado aguardando.</b><span>Quando um cliente chamar pela mesa, aparecerá aqui.</span></div>}
    {message && <div className="form-message">{message}</div>}
  </section>;
}
