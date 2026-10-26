"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { saoPauloDateKey } from "@/lib/business-hours";

type HistoryTicket = { id: string; status: string; table_order_id: string | null; public_order_id: string | null; ready_at: string | null; delivered_at: string | null; delivered_by_name: string | null };
type Item = { id: string; product_name: string; quantity: number; total_cents: number; table_order_id?: string; order_id?: string };
const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const onDay = (timestamp: string | null, day: string) => !!timestamp && saoPauloDateKey(new Date(timestamp)) === day;

export function KitchenHistory({ establishmentId }: { establishmentId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [day, setDay] = useState(() => saoPauloDateKey(new Date()));
  const [tickets, setTickets] = useState<HistoryTicket[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let stopped = false, fetching = false;
    async function load() {
      if (fetching || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
      fetching = true;
      try {
        const start = new Date(`${day}T00:00:00-03:00`).toISOString();
        const end = new Date(Date.parse(start) + 86400000).toISOString();
        const rows: HistoryTicket[] = [];
        for (let offset = 0; ; offset += 500) {
          const result = await supabase.from("kitchen_tickets")
            .select("id,status,table_order_id,public_order_id,ready_at,delivered_at,delivered_by_name")
            .eq("establishment_id", establishmentId).in("status", ["ready", "delivered"])
            .or(`and(ready_at.gte.${start},ready_at.lt.${end}),and(delivered_at.gte.${start},delivered_at.lt.${end})`)
            .order("id").range(offset, offset + 499);
          if (result.error) throw result.error;
          rows.push(...result.data);
          if (result.data.length < 500 || stopped) break;
        }
        const allItems: Item[] = [];
        for (const [table, key, ids] of [
          ["table_order_items", "table_order_id", [...new Set(rows.map(row => row.table_order_id).filter(Boolean))]],
          ["order_items", "order_id", [...new Set(rows.map(row => row.public_order_id).filter(Boolean))]],
        ] as const) {
          for (let index = 0; index < ids.length; index += 80) {
            for (let offset = 0; ; offset += 500) {
              const result = await supabase.from(table).select(`id,${key},product_name,quantity,total_cents`)
                .eq("establishment_id", establishmentId).in(key, ids.slice(index, index + 80) as string[]).order("id").range(offset, offset + 499);
              if (result.error) throw result.error;
              allItems.push(...result.data as unknown as Item[]);
              if (result.data.length < 500 || stopped) break;
            }
            if (stopped) return;
          }
        }
        if (!stopped) { setTickets(rows); setItems(allItems); setError(""); }
      } catch { if (!stopped) setError("Não foi possível atualizar o histórico. Tente novamente."); }
      finally { fetching = false; if (!stopped) setLoading(false); }
    }
    setLoading(true); setTickets([]); setItems([]);
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 15000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [day, retry, establishmentId, supabase]);
  const produced = tickets.filter(ticket => onDay(ticket.ready_at || ticket.delivered_at, day));
  const delivered = tickets.filter(ticket => ticket.status === "delivered" && onDay(ticket.delivered_at, day));
  const forTicket = (ticket: HistoryTicket) => items.filter(item => ticket.table_order_id ? item.table_order_id === ticket.table_order_id : item.order_id === ticket.public_order_id);
  const dailyItems = [...new Map(produced.flatMap(forTicket).map(item => [`${item.table_order_id ? "table" : "public"}:${item.id}`, item])).values()];
  const products = new Map<string, { name: string; quantity: number; total: number }>();
  for (const item of dailyItems) {
    const row = products.get(item.product_name) || { name: item.product_name, quantity: 0, total: 0 };
    row.quantity += item.quantity; row.total += item.total_cents; products.set(item.product_name, row);
  }
  return <section className="kitchen-history" aria-label="Histórico diário da cozinha">
    <header><div><h2>Produção e entregas do dia</h2><p>Histórico preservado mesmo depois de fechar o expediente.</p></div>
      <label>Consultar dia<input type="date" min="2020-01-01" max={saoPauloDateKey(new Date())} value={day} onChange={event => { if (event.target.value) setDay(event.target.value); }} /></label>
      <button onClick={() => setRetry(value => value + 1)}>Atualizar histórico</button></header>
    {loading ? <p role="status">Carregando histórico…</p> : error ? <p role="alert">{error}</p> : <>
      <div className="kitchen-history-totals"><span><b>{produced.length}</b> pedidos produzidos</span><span><b>{dailyItems.reduce((sum, item) => sum + item.quantity, 0)}</b> itens produzidos</span><span><b>{delivered.length}</b> pedidos entregues</span><span><b>{money(dailyItems.reduce((sum, item) => sum + item.total_cents, 0))}</b> valor dos itens produzidos</span></div>
      <p>Produção pela data em que ficou pronto (horário de Brasília). Valor dos itens, incluindo adicionais; não inclui frete, taxa de serviço ou descontos da conta e não representa recebimento no caixa.</p>
      <details><summary>Ver produção por produto ({products.size})</summary><div className="kitchen-history-scroll"><table><thead><tr><th>Produto</th><th>Quantidade</th><th>Valor</th></tr></thead><tbody>{[...products.values()].sort((a, b) => a.name.localeCompare(b.name)).map(row => <tr key={row.name}><td>{row.name}</td><td>{row.quantity}</td><td>{money(row.total)}</td></tr>)}</tbody></table></div>{!products.size && <p>Nenhuma produção registrada neste dia.</p>}</details>
      <details open><summary>Entregues — histórico ({delivered.length})</summary><div className="kitchen-history-delivered">{delivered.map(ticket => <article key={ticket.id}><b>Entregue às {new Date(ticket.delivered_at!).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}</b><span>{forTicket(ticket).map(item => `${item.quantity}× ${item.product_name}`).join(" · ") || "Pedido registrado"}</span><small>Confirmado por: {ticket.delivered_by_name || "Equipe"}</small></article>)}</div>{!delivered.length && <p>Nenhuma entrega registrada neste dia.</p>}</details>
    </>}
  </section>;
}
