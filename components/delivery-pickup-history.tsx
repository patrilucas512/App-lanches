"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Pickup = {
  id: number; delivery_id: string; actor_driver_id: string | null; occurred_at: string;
  metadata: { assignment_id?: string };
  deliveries: { orders: { order_number: number } | null } | null;
  driver_profiles: { custom_staff_members: { name: string } | null } | null;
};
const pageSize = 20;

export function DeliveryPickupHistory({ establishmentId }: { establishmentId: string }) {
  const [date, setDate] = useState("");
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [rows, setRows] = useState<Pickup[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    async function load() {
      setLoading(true); setError("");
      try {
        let query = createClient().from("delivery_events")
          .select("id,delivery_id,actor_driver_id,occurred_at,metadata,deliveries(orders(order_number)),driver_profiles(custom_staff_members(name))")
          .eq("establishment_id", establishmentId).eq("event_type", "pickup_verified")
          .order("occurred_at", { ascending: false }).order("id", { ascending: false });
        if (date) {
          const start = new Date(`${date}T00:00:00`);
          const end = new Date(start); end.setDate(end.getDate() + 1);
          query = query.gte("occurred_at", start.toISOString()).lt("occurred_at", end.toISOString());
        }
        const result = await query.range(page * pageSize, page * pageSize + pageSize);
        if (result.error) throw result.error;
        if (current) {
          const data = (result.data || []) as unknown as Pickup[];
          setRows(data.slice(0, pageSize)); setHasNext(data.length > pageSize);
        }
      } catch {
        if (current) setError("Não foi possível consultar as retiradas. Tente novamente.");
      } finally { if (current) setLoading(false); }
    }
    void load();
    return () => { current = false; };
  }, [establishmentId, date, page, revision]);

  return <section className="pickup-history" aria-labelledby="pickup-history-title">
    <header className="team-group-head"><div><small>REGISTRO DE CUSTÓDIA</small><h3 id="pickup-history-title">Provas de retirada</h3><p>Quem retirou cada pedido e quando o código foi validado. O registro continua disponível após a entrega.</p></div>
      <button className="button outline" disabled={loading} onClick={() => setRevision(value => value + 1)}>Atualizar</button>
    </header>
    <label>Data da retirada (horário deste aparelho)<input className="input" type="date" value={date} onChange={event => { setDate(event.target.value); setPage(0); }} /></label>
    {date && <button className="button outline" onClick={() => { setDate(""); setPage(0); }}>Todas as datas</button>}
    <div aria-live="polite" aria-busy={loading}>
      {loading ? <p role="status">Consultando registros de retirada…</p> : error ? <div role="alert"><p>{error}</p><button className="button outline" onClick={() => setRevision(value => value + 1)}>Tentar novamente</button></div> : rows.length ? <ul className="pickup-history-list">{rows.map(row => <li key={row.id}>
        <header><b>Pedido #{row.deliveries?.orders?.order_number ?? "—"}</b><span>Código validado</span></header>
        <dl><div><dt>Retirado por</dt><dd>{row.driver_profiles?.custom_staff_members?.name || "Cadastro não disponível"}</dd></div>
          <div><dt>Data e horário</dt><dd><time dateTime={row.occurred_at}>{new Date(row.occurred_at).toLocaleString("pt-BR")}</time></dd></div></dl>
        <details><summary>Identificadores para conferência</summary><p>Registro: {row.id}</p><p>Entrega: {row.delivery_id}</p><p>Motoboy: {row.actor_driver_id || "Não disponível no registro"}</p><p>Atribuição: {row.metadata?.assignment_id || "Não disponível no registro"}</p></details>
      </li>)}</ul> : <p>Nenhuma retirada com código validado neste período.</p>}
    </div>
    <nav aria-label="Páginas de provas de retirada"><button className="button outline" disabled={loading || page === 0} onClick={() => setPage(value => value - 1)}>Anterior</button><span>Página {page + 1}</span><button className="button outline" disabled={loading || !!error || !hasNext} onClick={() => setPage(value => value + 1)}>Próxima</button></nav>
    <p>Somente validações registradas pelo sistema são exibidas. O código secreto não é mostrado neste histórico.</p>
  </section>;
}
