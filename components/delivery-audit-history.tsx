"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type EventRow = {
  id: number; event_type: string; occurred_at: string; actor_user_id: string | null;
  actor_driver_id: string | null; actor_type: string; delivery_id: string;
  from_status: string | null; to_status: string | null;
  deliveries: { orders: { order_number: number } | null } | null;
  driver_profiles: { custom_staff_members: { name: string } | null } | null;
};
type AuditRow = { id: string; action: string; created_at: string; actor_id: string | null; entity_type: string | null; entity_id: string | null };
type Row = { id: string; action: string; at: string; actor: string; actorId: string | null; driverId?: string | null; target: string; targetId: string | null; transition?: string };
const actionLabels: Record<string, string> = {
  pickup_verified: "Retirada validada", pickup_code_failed: "Código de retirada não validado",
  delivery_pin_verified: "Entrega confirmada por PIN", delivery_pin_failed: "PIN não validado",
  delivery_completed_without_pin: "Entrega concluída por exceção", driver_offer_accepted: "Chamada aceita",
  driver_offer_rejected: "Chamada recusada", driver_offer_expired: "Chamada expirada",
  driver_offer_created: "Chamada enviada", dispatch_started: "Despacho iniciado",
  incident_reported: "Ocorrência registrada", driver_arrived: "Chegada registrada",
  "delivery.pickup_code_issued": "Código de retirada emitido", "delivery.pickup_verified": "Retirada validada",
  "delivery.ready_for_dispatch": "Pedido pronto para despacho", "delivery.completed_with_pin": "Entrega confirmada por PIN",
  "delivery.completed_without_pin": "Conclusão autorizada sem PIN", "delivery.assignment_accepted": "Atribuição aceita",
  "delivery.group_assignment_accepted": "Atribuição agrupada aceita", "delivery.group_approved": "Agrupamento aprovado",
  "delivery.group_ignored": "Agrupamento ignorado", "driver.invite_created": "Convite de motoboy criado",
  "driver.invite_claimed": "Convite utilizado", "driver.availability_changed": "Disponibilidade alterada",
  "driver.deactivated": "Motoboy desativado", "driver.compensation_policy_created": "Regra de repasse cadastrada",
  "driver.financial_adjustment_created": "Ajuste financeiro registrado", "driver.financial_period_closed": "Período financeiro fechado",
};

export function DeliveryAuditHistory({ establishmentId }: { establishmentId: string }) {
  const [source, setSource] = useState("events");
  const [date, setDate] = useState("");
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    async function load() {
      setLoading(true); setError("");
      try {
        const client = createClient();
        const timeColumn = source === "events" ? "occurred_at" : "created_at";
        let query = source === "events"
          ? client.from("delivery_events").select("id,event_type,occurred_at,actor_user_id,actor_driver_id,actor_type,delivery_id,from_status,to_status,deliveries(orders(order_number)),driver_profiles(custom_staff_members(name))")
          : client.from("audit_logs").select("id,action,created_at,actor_id,entity_type,entity_id").or("action.like.delivery.%,action.like.driver.%");
        query = query.eq("establishment_id", establishmentId).order(timeColumn, { ascending: false }).order("id", { ascending: false });
        if (date) {
          const start = new Date(`${date}T00:00:00`); const end = new Date(start); end.setDate(end.getDate() + 1);
          query = query.gte(timeColumn, start.toISOString()).lt(timeColumn, end.toISOString());
        }
        const result = await query.range(page * 20, page * 20 + 20);
        if (result.error) throw result.error;
        const records = result.data || [];
        const mapped: Row[] = source === "events" ? (records as unknown as EventRow[]).slice(0, 20).map(row => ({
          id: String(row.id), action: row.event_type, at: row.occurred_at,
          actor: row.driver_profiles?.custom_staff_members?.name || (row.actor_type === "system" ? "Sistema" : "Usuário registrado"),
          actorId: row.actor_user_id, driverId: row.actor_driver_id,
          target: `Pedido #${row.deliveries?.orders?.order_number ?? "—"}`, targetId: row.delivery_id,
          transition: row.from_status || row.to_status ? `${row.from_status || "—"} → ${row.to_status || "—"}` : undefined,
        })) : (records as unknown as AuditRow[]).slice(0, 20).map(row => ({
          id: row.id, action: row.action, at: row.created_at, actor: row.actor_id ? "Usuário registrado" : "Autor não informado",
          actorId: row.actor_id, target: row.entity_type || "Registro administrativo", targetId: row.entity_id,
        }));
        if (current) { setRows(mapped); setHasNext(records.length > 20); }
      } catch { if (current) setError("Não foi possível consultar a auditoria. Tente novamente."); }
      finally { if (current) setLoading(false); }
    }
    void load(); return () => { current = false; };
  }, [establishmentId, source, date, page, revision]);

  return <section className="pickup-history" aria-labelledby="delivery-audit-title">
    <header className="team-group-head"><div><small>CONSULTA SOMENTE LEITURA</small><h3 id="delivery-audit-title">Histórico e auditoria</h3><p>Consulte os eventos registrados e as ações administrativas de entregas e motoboys.</p></div><button className="button outline" disabled={loading} onClick={() => setRevision(value => value + 1)}>Atualizar</button></header>
    <label>Tipo de registro<select className="input" value={source} onChange={event => { setSource(event.target.value); setPage(0); }}><option value="events">Eventos das entregas</option><option value="admin">Ações administrativas e financeiras</option></select></label>
    <label>Data (horário deste aparelho)<input className="input" type="date" value={date} onChange={event => { setDate(event.target.value); setPage(0); }} /></label>
    {date && <button className="button outline" onClick={() => { setDate(""); setPage(0); }}>Todas as datas</button>}
    <div aria-live="polite" aria-busy={loading}>{loading ? <p role="status">Consultando histórico…</p> : error ? <div role="alert"><p>{error}</p><button className="button outline" onClick={() => setRevision(value => value + 1)}>Tentar novamente</button></div> : rows.length ? <ul className="pickup-history-list">{rows.map(row => <li key={row.id}>
      <header><b>{actionLabels[row.action] || "Evento registrado"}</b><time dateTime={row.at}>{new Date(row.at).toLocaleString("pt-BR")}</time></header>
      <p>{row.target} · {row.actor}</p><details><summary>Conferir identificadores</summary><p>Ação: {row.action}</p><p>Registro: {row.id}</p><p>Entidade: {row.targetId || "Não informada"}</p><p>Usuário responsável: {row.actorId || "Não informado"}</p>{row.driverId && <p>Motoboy: {row.driverId}</p>}{row.transition && <p>Transição registrada: {row.transition}</p>}</details>
    </li>)}</ul> : <p>Nenhum registro encontrado para estes filtros.</p>}</div>
    <nav aria-label="Páginas de auditoria"><button className="button outline" disabled={loading || !page} onClick={() => setPage(value => value - 1)}>Anterior</button><span>Página {page + 1}</span><button className="button outline" disabled={loading || !!error || !hasNext} onClick={() => setPage(value => value + 1)}>Próxima</button></nav>
    <p>Códigos, PINs e conteúdo técnico de pagamentos não são consultados nesta tela. Valores e motivos financeiros permanecem no relatório de repasses. A ausência de um evento não comprova que uma ação não ocorreu.</p>
  </section>;
}
