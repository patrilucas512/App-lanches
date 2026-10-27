"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { deliveryProofLabel, hasDeliveryCoordinates } from "@/lib/delivery-proof";

type Completion = {
  id: string; delivered_at: string | null; delivered_driver_profile_id: string | null;
  delivery_confirmation_method: string | null; delivery_pin_verified: boolean;
  delivery_completion_reason: string | null; delivery_verified_by: string | null;
  delivery_latitude: number | null; delivery_longitude: number | null;
  delivery_accuracy_meters: number | null; delivery_location_captured_at: string | null;
  orders: { order_number: number } | null;
  driver_profiles: { custom_staff_members: { name: string } | null } | null;
};
const pageSize = 20;

export function DeliveryCompletionHistory({ establishmentId }: { establishmentId: string }) {
  const [date, setDate] = useState("");
  const [method, setMethod] = useState("");
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [rows, setRows] = useState<Completion[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    async function load() {
      setLoading(true); setError("");
      try {
        let query = createClient().from("deliveries")
          .select("id,delivered_at,delivered_driver_profile_id,delivery_confirmation_method,delivery_pin_verified,delivery_completion_reason,delivery_verified_by,delivery_latitude,delivery_longitude,delivery_accuracy_meters,delivery_location_captured_at,orders(order_number),driver_profiles!deliveries_delivered_driver_tenant_fk(custom_staff_members(name))")
          .eq("establishment_id", establishmentId).eq("status", "delivered")
          .order("delivered_at", { ascending: false, nullsFirst: false }).order("id", { ascending: false });
        if (method) query = query.eq("delivery_confirmation_method", method);
        if (date) {
          const start = new Date(`${date}T00:00:00`);
          const end = new Date(start); end.setDate(end.getDate() + 1);
          query = query.gte("delivered_at", start.toISOString()).lt("delivered_at", end.toISOString());
        }
        const result = await query.range(page * pageSize, page * pageSize + pageSize);
        if (result.error) throw result.error;
        if (current) {
          const data = (result.data || []) as unknown as Completion[];
          setRows(data.slice(0, pageSize)); setHasNext(data.length > pageSize);
        }
      } catch {
        if (current) setError("Não foi possível consultar as provas de entrega. Tente novamente.");
      } finally { if (current) setLoading(false); }
    }
    void load();
    return () => { current = false; };
  }, [establishmentId, date, method, page, revision]);

  return <section className="pickup-history" aria-labelledby="completion-history-title">
    <header className="team-group-head"><div><small>CONFERÊNCIA DA CONCLUSÃO</small><h3 id="completion-history-title">Provas de entrega</h3><p>Responsável e confirmação registrados na conclusão, sem expor o PIN secreto do cliente.</p></div><button className="button outline" disabled={loading} onClick={() => setRevision(value => value + 1)}>Atualizar</button></header>
    <label>Data da entrega (horário deste aparelho)<input className="input" type="date" value={date} onChange={event => { setDate(event.target.value); setPage(0); }} /></label>
    <label>Forma de confirmação<select className="input" value={method} onChange={event => { setMethod(event.target.value); setPage(0); }}><option value="">Todas</option><option value="pin">Por PIN</option><option value="admin_exception">Exceção administrativa</option><option value="legacy">Registro antigo</option></select></label>
    {(date || method) && <button className="button outline" onClick={() => { setDate(""); setMethod(""); setPage(0); }}>Limpar filtros</button>}
    <div aria-live="polite" aria-busy={loading}>
      {loading ? <p role="status">Consultando provas de entrega…</p> : error ? <div role="alert"><p>{error}</p><button className="button outline" onClick={() => setRevision(value => value + 1)}>Tentar novamente</button></div> : rows.length ? <ul className="pickup-history-list">{rows.map(row => <li key={row.id}>
        <header><b>Pedido #{row.orders?.order_number ?? "—"}</b><span>{deliveryProofLabel(row.delivery_confirmation_method, row.delivery_pin_verified)}</span></header>
        <dl><div><dt>Entregue por</dt><dd>{row.driver_profiles?.custom_staff_members?.name || "Cadastro não disponível"}</dd></div><div><dt>Conclusão</dt><dd>{row.delivered_at ? <time dateTime={row.delivered_at}>{new Date(row.delivered_at).toLocaleString("pt-BR")}</time> : "Horário não registrado"}</dd></div></dl>
        {row.delivery_confirmation_method === "admin_exception" && <p><b>Motivo da exceção:</b> {row.delivery_completion_reason || "Motivo não disponível · conferir auditoria"}</p>}
        <details><summary>Conferir localização e identificadores</summary>
          {hasDeliveryCoordinates(row.delivery_latitude, row.delivery_longitude) ? <><p>GPS registrado: {row.delivery_latitude}, {row.delivery_longitude}</p><p>Precisão: {row.delivery_accuracy_meters === null ? "não informada" : `${row.delivery_accuracy_meters} m`}. Capturado em: {row.delivery_location_captured_at ? new Date(row.delivery_location_captured_at).toLocaleString("pt-BR") : "horário não informado"}.</p><p>Este é o sinal salvo na conclusão, não uma posição ao vivo nem garantia do endereço exato.</p></> : <p>GPS não registrado nesta conclusão. Isso não comprova, por si só, falha na entrega.</p>}
          <p>Entrega: {row.id}</p><p>Motoboy: {row.delivered_driver_profile_id || "Não disponível"}</p><p>Usuário que confirmou: {row.delivery_verified_by || "Não disponível"}</p>
        </details>
      </li>)}</ul> : <p>Nenhuma entrega concluída para estes filtros.</p>}
    </div>
    <nav aria-label="Páginas de provas de entrega"><button className="button outline" disabled={loading || page === 0} onClick={() => setPage(value => value - 1)}>Anterior</button><span>Página {page + 1}</span><button className="button outline" disabled={loading || !!error || !hasNext} onClick={() => setPage(value => value + 1)}>Próxima</button></nav>
  </section>;
}
