"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { subscribeToPush, supportsPushNotifications } from "@/lib/push-notifications";
import { DeliveryPickupHistory } from "@/components/delivery-pickup-history";
import { DeliveryCompletionHistory } from "@/components/delivery-completion-history";
import { DeliveryAuditHistory } from "@/components/delivery-audit-history";

type Driver = { driver_profile_id: string; status: string; driver_profiles?: { custom_staff_members?: { name: string } | null } | null };
type Delivery = { id: string; status: string; ready_at: string | null; dispatch_started_at: string | null; customer_delivery_fee_cents: number; estimated_min_minutes: number | null; estimated_max_minutes: number | null; estimated_arrival_at: string | null; orders?: { order_number: number; customer_name: string; total_cents: number } | null };
type Assignment = { id: string; delivery_id: string; driver_profile_id: string; group_suggestion_id: string | null; status: string; expires_at: string; driver_profiles?: { custom_staff_members?: { name: string } | null } | null };
type PickupCredential = { code: string; expires_at?: string };
type DashboardStats = { deliveries_today: number; preparing: number; waiting_driver: number; collecting: number; on_route: number; completed: number; problems: number; average_minutes: number; delivery_fees_cents: number };
type DriverLocation = { latitude: number; longitude: number; accuracy_meters: number | null; captured_at: string; received_at: string; delivery_id: string | null };
type MonitoredDriver = { driver_profile_id: string; name: string; status: string; last_activity_at: string | null; deliveries_today: number; delivery_fees_cents: number; location: DriverLocation | null; active_delivery: { id: string; status: string; order_number: number; customer_name: string; destination: Record<string, string> | null } | null };
type DeliveryEvent = { id: number; delivery_id: string; order_number: number; event_type: string; from_status: string | null; to_status: string | null; actor_type: string; driver_name: string | null; occurred_at: string; metadata: Record<string, unknown> };
type DeliveryIncident = { id: string; delivery_id: string; order_number: number; type: string; description: string; status: string; driver_name: string | null; created_at: string };
type OperationsDashboard = { generated_at: string; stats: DashboardStats; drivers: MonitoredDriver[]; events: DeliveryEvent[]; incidents: DeliveryIncident[] };
type GroupedDelivery = { id: string; order_number: number; customer_name: string; neighborhood: string };
type GroupSuggestion = { id: string; status: "suggested" | "approved"; compatibility_score: number; reason: string; expires_at: string; first_delivery: GroupedDelivery; second_delivery: GroupedDelivery };
type OperationalAlert = { id: string; delivery_id: string; alert_type: string; severity: "warning" | "critical"; title: string; message: string; age_minutes: number; threshold_minutes: number; detected_at: string; last_detected_at: string; detection_data: { order_number?: number } };

const activeDeliveryStatuses = ["ready_for_dispatch", "searching_driver", "driver_assigned", "driver_to_pickup", "picked_up", "on_route", "arrived", "returning_to_store"];
const deliveryLabels: Record<string, string> = {
  ready_for_dispatch: "PRONTO PARA DESPACHO", searching_driver: "PROCURANDO MOTOBOY", driver_assigned: "MOTOBOY CONFIRMADO",
  driver_to_pickup: "MOTOBOY INDO RETIRAR", picked_up: "PEDIDO RETIRADO", on_route: "EM ROTA", arrived: "MOTOBOY NO ENDEREÇO", returning_to_store: "RETORNANDO À LOJA",
};
const driverLabels: Record<string, string> = { available: "Disponível", offered: "Chamada recebida", collecting: "Em coleta", delivering: "Em entrega", paused: "Pausado", offline: "Offline", blocked: "Bloqueado" };
const eventLabels: Record<string, string> = {
  pickup_verified: "Código de retirada validado", pickup_code_failed: "Tentativa de retirada não validada",
  delivery_pin_verified: "Entrega confirmada com PIN", delivery_pin_failed: "Tentativa de PIN não validada",
  dispatch_started: "Despacho iniciado", driver_offer_created: "Chamada enviada", driver_offer_accepted: "Entrega aceita",
  driver_offer_rejected: "Chamada recusada", driver_offer_expired: "Chamada expirada", pickup_confirmed: "Retirada confirmada",
  driver_departed: "Saiu para entrega", driver_arrived: "Chegou ao destino", delivery_completed: "Entrega concluída",
  delivery_completed_without_pin: "Concluída por exceção", incident_reported: "Ocorrência registrada", return_to_store_confirmed: "Retorno confirmado",
  group_dispatch_started: "Despacho agrupado iniciado", driver_group_offer_created: "Chamada dupla enviada",
  driver_group_offer_accepted: "Duas entregas aceitas", driver_group_offer_rejected: "Chamada dupla recusada",
  driver_group_offer_expired: "Chamada dupla expirada",
};

export function DeliveryDispatchManager({ establishmentId, initialDeliveries, initialDrivers, initialAssignments, initialDashboard, initialAlerts }: { establishmentId: string; initialDeliveries: Delivery[]; initialDrivers: Driver[]; initialAssignments: Assignment[]; initialDashboard: OperationsDashboard | null; initialAlerts: OperationalAlert[] }) {
  const [deliveries, setDeliveries] = useState(initialDeliveries);
  const [drivers, setDrivers] = useState(initialDrivers);
  const [assignments, setAssignments] = useState(initialAssignments);
  const [pickupCredentials, setPickupCredentials] = useState<Record<string, PickupCredential>>({});
  const [manualReasons, setManualReasons] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [showAuditHistory, setShowAuditHistory] = useState(false);
  const [pushStatus, setPushStatus] = useState<"unsupported" | "inactive" | "active">(() => supportsPushNotifications() ? "inactive" : "unsupported");
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [groupSuggestions, setGroupSuggestions] = useState<GroupSuggestion[]>([]);
  const [operationalAlerts, setOperationalAlerts] = useState(initialAlerts);
  const [selectedDriverId, setSelectedDriverId] = useState(initialDashboard?.drivers.find(driver => driver.location || driver.active_delivery)?.driver_profile_id || "");
  const money = useMemo(() => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }), []);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const [{ data: nextDeliveries }, { data: nextDrivers }, { data: nextAssignments }, { data: nextDashboard }, { data: nextGroups }, { data: nextAlerts }] = await Promise.all([
      supabase.from("deliveries").select("id,status,ready_at,dispatch_started_at,customer_delivery_fee_cents,estimated_min_minutes,estimated_max_minutes,estimated_arrival_at,orders(order_number,customer_name,total_cents)").eq("establishment_id", establishmentId).in("status", activeDeliveryStatuses).order("ready_at", { ascending: true }),
      supabase.from("driver_availability").select("driver_profile_id,status,driver_profiles(custom_staff_members(name))").eq("establishment_id", establishmentId),
      supabase.from("delivery_assignments").select("id,delivery_id,driver_profile_id,group_suggestion_id,status,expires_at,driver_profiles(custom_staff_members(name))").eq("establishment_id", establishmentId).in("status", ["offered", "accepted"]),
      supabase.rpc("get_delivery_operations_dashboard", { requested_establishment_id: establishmentId }),
      supabase.rpc("refresh_delivery_group_suggestions", { requested_establishment_id: establishmentId }),
      supabase.rpc("refresh_delivery_operational_alerts", { requested_establishment_id: establishmentId }),
    ]);
    if (nextDeliveries) setDeliveries(nextDeliveries as unknown as Delivery[]);
    if (nextDrivers) setDrivers(nextDrivers as unknown as Driver[]);
    if (nextAssignments) setAssignments(nextAssignments as unknown as Assignment[]);
    if (nextDashboard) setDashboard(nextDashboard as unknown as OperationsDashboard);
    if (nextGroups) setGroupSuggestions(nextGroups as unknown as GroupSuggestion[]);
    if (nextAlerts) setOperationalAlerts(nextAlerts as unknown as OperationalAlert[]);
  }, [establishmentId]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`admin-dispatch-${establishmentId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "deliveries", filter: `establishment_id=eq.${establishmentId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "driver_availability", filter: `establishment_id=eq.${establishmentId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "delivery_assignments", filter: `establishment_id=eq.${establishmentId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "delivery_group_suggestions", filter: `establishment_id=eq.${establishmentId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "delivery_operational_alerts", filter: `establishment_id=eq.${establishmentId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "delivery_incidents", filter: `establishment_id=eq.${establishmentId}` }, refresh).subscribe();
    void refresh();
    const timer = window.setInterval(() => void refresh(), 7000);
    return () => { window.clearInterval(timer); void supabase.removeChannel(channel); };
  }, [establishmentId, refresh]);

  const enablePushNotifications = useCallback(async (askPermission = true) => {
    const subscription = await subscribeToPush(askPermission).catch(() => null);
    if (!subscription) { if (askPermission) setMessage("Permita as notificações do navegador para receber alertas da operação."); return; }
    const { error } = await createClient().rpc("register_operations_push_subscription", {
      requested_establishment_id: establishmentId,
      requested_subscription: subscription,
    });
    if (error) { if (askPermission) setMessage(error.message); return; }
    setPushStatus("active");
    if (askPermission) setMessage("Alertas da Central de Entregas ativados neste aparelho.");
  }, [establishmentId]);

  useEffect(() => { if (typeof Notification !== "undefined" && Notification.permission === "granted") void enablePushNotifications(false); }, [enablePushNotifications]);

  async function call(name: string, params: Record<string, unknown>, id: string, success: string) {
    setBusyId(id); setMessage("");
    const { data, error } = await createClient().rpc(name, params);
    if (error) setMessage(error.message);
    else if (data && typeof data === "object" && "offered" in data && data.offered === false) setMessage(String(data.reason || "Nenhum motoboy disponível."));
    else setMessage(success);
    if (!error) await refresh();
    setBusyId(""); return data;
  }

  async function issuePickupCode(deliveryId: string) {
    const data = await call("issue_pickup_code", { requested_delivery_id: deliveryId }, deliveryId, "Código de retirada gerado. Mostre-o somente ao motoboy responsável.");
    if (data?.code) setPickupCredentials(current => ({ ...current, [deliveryId]: { code: String(data.code), expires_at: data.expires_at } }));
  }

  async function completeWithoutPin(deliveryId: string) {
    const reason = (manualReasons[deliveryId] || "").trim();
    if (reason.length < 5) return setMessage("Informe o motivo da conclusão sem PIN com pelo menos 5 caracteres.");
    await call("complete_delivery_without_pin", { requested_delivery_id: deliveryId, requested_reason: reason }, deliveryId, "Entrega concluída por exceção administrativa e registrada na auditoria.");
  }

  async function decideGroup(suggestionId: string, decision: "approved" | "ignored") {
    await call("decide_delivery_group_suggestion", {
      requested_suggestion_id: suggestionId,
      requested_decision: decision,
    }, suggestionId, decision === "approved"
      ? "Agrupamento aprovado e registrado para a equipe de despacho."
      : "Sugestão ignorada sem alterar os pedidos.");
  }

  async function startGroupDispatch(suggestionId: string) {
    await call("start_delivery_group_dispatch", {
      requested_suggestion_id: suggestionId,
    }, suggestionId, "Chamada com os dois pedidos enviada ao próximo motoboy disponível.");
  }

  const availableCount = drivers.filter(driver => driver.status === "available").length;
  const activeCount = drivers.filter(driver => ["offered", "collecting", "delivering"].includes(driver.status)).length;
  const selectedDriver = dashboard?.drivers.find(driver => driver.driver_profile_id === selectedDriverId) || null;
  const destination = selectedDriver?.active_delivery?.destination;
  const destinationLabel = destination ? [destination.street, destination.number, destination.neighborhood, destination.city].filter(Boolean).join(", ") : "Endereço liberado quando houver entrega ativa";
  const mapUrl = selectedDriver?.location ? `https://www.openstreetmap.org/?mlat=${selectedDriver.location.latitude}&mlon=${selectedDriver.location.longitude}#map=17/${selectedDriver.location.latitude}/${selectedDriver.location.longitude}` : "";
  const statCards = dashboard ? [
    ["Entregas hoje", dashboard.stats.deliveries_today], ["Em preparo", dashboard.stats.preparing], ["Aguardando motoboy", dashboard.stats.waiting_driver],
    ["Em coleta", dashboard.stats.collecting], ["Em rota", dashboard.stats.on_route], ["Concluídas", dashboard.stats.completed],
    ["Ocorrências", dashboard.stats.problems], ["Tempo médio", `${dashboard.stats.average_minutes} min`], ["Taxas de entrega", money.format(dashboard.stats.delivery_fees_cents / 100)],
  ] : [];

  return <section className="panel delivery-dispatch-panel" id="despacho-entregas">
    <header className="team-group-head"><div><small>CENTRAL DE ENTREGAS · TEMPO REAL</small><h2>Despacho, monitoramento e custódia</h2><p>Acompanhe a operação, a equipe e cada etapa da entrega em uma única central administrativa.</p></div><div className="dispatch-summary"><span>{availableCount} disponíveis</span><strong>{activeCount} em operação</strong>{pushStatus !== "unsupported" && <button className={`button outline ${pushStatus === "active" ? "notification-active" : ""}`} onClick={() => void enablePushNotifications(true)}>{pushStatus === "active" ? "Alertas ativos" : "Ativar alertas"}</button>}</div></header>
    {message && <div className="form-message" role="status">{message}</div>}
    {dashboard && <div className="delivery-operations-stats" aria-label="Indicadores das entregas">{statCards.map(([label, value]) => <article key={label}><small>{label}</small><strong>{value}</strong></article>)}</div>}

    <div className={`delivery-operational-alerts ${operationalAlerts.length ? "has-alerts" : "all-clear"}`} aria-live="polite" aria-label="Alertas operacionais de atraso">
      <header><div><small>CONTROLE DE PRAZOS · TEMPO REAL</small><h3>Alertas operacionais</h3><p>Detecta atrasos de cozinha, despacho, localização e rota. O aviso desaparece automaticamente quando a operação normaliza.</p></div><span>{operationalAlerts.length ? `${operationalAlerts.length} em atenção` : "Operação no prazo"}</span></header>
      {operationalAlerts.length > 0 && <div className="delivery-operational-alert-list">{operationalAlerts.map(alert => <article key={alert.id} className={`severity-${alert.severity}`}>
        <div className="delivery-alert-icon" aria-hidden="true">{alert.severity === "critical" ? "!" : "⏱"}</div>
        <div><small>{alert.severity === "critical" ? "CRÍTICO" : "ATENÇÃO"} · PEDIDO #{alert.detection_data?.order_number || "—"}</small><b>{alert.title}</b><p>{alert.message}</p></div>
        <span><strong>{alert.age_minutes} min</strong><small>limite {alert.threshold_minutes} min</small></span>
      </article>)}</div>}
    </div>

    {groupSuggestions.length > 0 && <div className="delivery-group-suggestions" aria-label="Sugestões de entregas agrupadas">
      <header><div><small>ENTREGAS AGRUPADAS · APROVAÇÃO MANUAL</small><h3>Rotas compatíveis encontradas</h3><p>O sistema apenas sugere. Confira os pedidos antes de aprovar.</p></div><span>{groupSuggestions.length} sugestão{groupSuggestions.length === 1 ? "" : "ões"}</span></header>
      <div>{groupSuggestions.map(suggestion => {
        const groupedDeliveries = deliveries.filter(delivery => [suggestion.first_delivery.id, suggestion.second_delivery.id].includes(delivery.id));
        const groupedAssignment = assignments.find(assignment => assignment.group_suggestion_id === suggestion.id);
        const canStart = groupedDeliveries.length === 2 && groupedDeliveries.every(delivery => ["ready_for_dispatch", "searching_driver"].includes(delivery.status));
        return <article key={suggestion.id} className={`delivery-group-card status-${suggestion.status}`}>
        <div className="delivery-group-score"><b>{suggestion.compatibility_score}%</b><span>compatível</span></div>
        <div className="delivery-group-orders">
          <div><small>PEDIDO</small><b>#{suggestion.first_delivery.order_number}</b><span>{suggestion.first_delivery.customer_name}</span></div>
          <i aria-hidden="true">+</i>
          <div><small>PEDIDO</small><b>#{suggestion.second_delivery.order_number}</b><span>{suggestion.second_delivery.customer_name}</span></div>
        </div>
        <div className="delivery-group-reason"><b>{suggestion.first_delivery.neighborhood}</b><span>{suggestion.reason}</span></div>
        {suggestion.status === "suggested" ? <div className="delivery-group-actions"><button className="button dark" disabled={busyId === suggestion.id} onClick={() => void decideGroup(suggestion.id, "approved")}>Aprovar agrupamento</button><button className="button outline" disabled={busyId === suggestion.id} onClick={() => void decideGroup(suggestion.id, "ignored")}>Ignorar</button></div> : <div className="delivery-group-actions"><strong className="delivery-group-approved">Agrupamento aprovado</strong>{canStart && !groupedAssignment && <button className="button dark" disabled={busyId === suggestion.id} onClick={() => void startGroupDispatch(suggestion.id)}>Despachar os 2 pedidos</button>}{groupedAssignment?.status === "offered" && <span className="delivery-group-progress">Chamada dupla enviada</span>}{groupedDeliveries.some(delivery => !["ready_for_dispatch", "searching_driver"].includes(delivery.status)) && <span className="delivery-group-progress">Rota agrupada em operação</span>}</div>}
      </article>})}</div>
    </div>}

    <div className="delivery-monitor-layout">
      <div className="delivery-driver-cards" aria-label="Situação dos motoboys">{dashboard?.drivers.length ? dashboard.drivers.map(driver => <article key={driver.driver_profile_id} className={`delivery-driver-card status-${driver.status} ${selectedDriverId === driver.driver_profile_id ? "selected" : ""}`}>
        <header><i className={`driver-dot status-${driver.status}`} /><div><b>{driver.name}</b><span>{driverLabels[driver.status] || driver.status}</span></div></header>
        <dl><div><dt>Entregas hoje</dt><dd>{driver.deliveries_today}</dd></div><div><dt>Taxas operadas</dt><dd>{money.format(driver.delivery_fees_cents / 100)}</dd></div></dl>
        <small>{driver.last_activity_at ? `Atualizado ${new Date(driver.last_activity_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "Sem atividade recente"}</small>
        <button className="button outline wide" type="button" onClick={() => setSelectedDriverId(driver.driver_profile_id)}>Monitorar</button>
      </article>) : <p>Nenhum motoboy cadastrado.</p>}</div>

      <aside className="delivery-map-panel" aria-live="polite">
        <span className="kicker">MAPA OPERACIONAL</span>
        {selectedDriver ? <>
          <h3>{selectedDriver.name}</h3><span className={`driver-status status-${selectedDriver.status}`}>{driverLabels[selectedDriver.status] || selectedDriver.status}</span>
          <div className="delivery-map-route"><div><i>1</i><span><small>ORIGEM</small><b>Estabelecimento</b></span></div><div><i>2</i><span><small>DESTINO</small><b>{destinationLabel}</b></span></div></div>
          {selectedDriver.active_delivery && <p>Pedido <b>#{selectedDriver.active_delivery.order_number}</b> · {selectedDriver.active_delivery.customer_name} · {deliveryLabels[selectedDriver.active_delivery.status] || selectedDriver.active_delivery.status}</p>}
          {selectedDriver.location ? <><div className="delivery-coordinate"><small>ÚLTIMA POSIÇÃO EXATA · SOMENTE ADMINISTRAÇÃO</small><b>{selectedDriver.location.latitude.toFixed(5)}, {selectedDriver.location.longitude.toFixed(5)}</b><span>Precisão {selectedDriver.location.accuracy_meters ? `aprox. ${Math.round(selectedDriver.location.accuracy_meters)} m` : "não informada"} · {new Date(selectedDriver.location.received_at).toLocaleString("pt-BR")}</span></div><a className="button dark wide" href={mapUrl} target="_blank" rel="noreferrer">Abrir posição no mapa</a></> : <div className="empty compact"><b>Localização ainda não recebida.</b><span>Ela aparece quando o motoboy autorizar o GPS durante a entrega.</span></div>}
        </> : <div className="empty compact"><b>Selecione um motoboy.</b><span>Use “Monitorar” para ver a atividade e a última posição autorizada.</span></div>}
      </aside>
    </div>

    {deliveries.length ? <div className="dispatch-delivery-grid">{deliveries.map(delivery => {
      const assignment = assignments.find(item => item.delivery_id === delivery.id);
      const approvedGroup = groupSuggestions.find(suggestion => suggestion.status === "approved" && [suggestion.first_delivery.id, suggestion.second_delivery.id].includes(delivery.id));
      const groupAssignment = approvedGroup ? assignments.find(item => item.group_suggestion_id === approvedGroup.id) : null;
      const driverName = assignment?.driver_profiles?.custom_staff_members?.name;
      const credential = pickupCredentials[delivery.id];
      const deliveryAlerts = operationalAlerts.filter(alert => alert.delivery_id === delivery.id);
      return <article key={delivery.id} className={`dispatch-card status-${delivery.status} ${deliveryAlerts.length ? "has-operational-alert" : ""}`}>
        <div><small>{deliveryLabels[delivery.status] || delivery.status}</small><span>{delivery.ready_at ? new Date(delivery.ready_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "Agora"}</span></div>
        <h3>Pedido #{delivery.orders?.order_number}</h3><p>{delivery.orders?.customer_name}</p><dl><div><dt>Total</dt><dd>{money.format((delivery.orders?.total_cents || 0) / 100)}</dd></div><div><dt>Taxa</dt><dd>{money.format(delivery.customer_delivery_fee_cents / 100)}</dd></div></dl>
        {delivery.estimated_min_minutes && delivery.estimated_max_minutes && <div className="dispatch-eta"><small>PREVISÃO AO CLIENTE</small><b>{delivery.estimated_min_minutes}–{delivery.estimated_max_minutes} min</b>{delivery.estimated_arrival_at && <span>Limite estimado: {new Date(delivery.estimated_arrival_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>}</div>}
        {deliveryAlerts.length > 0 && <div className={`dispatch-alert-summary severity-${deliveryAlerts.some(alert => alert.severity === "critical") ? "critical" : "warning"}`}><small>ATENÇÃO OPERACIONAL</small><b>{deliveryAlerts.map(alert => alert.title).join(" · ")}</b></div>}
        {driverName && <div className="dispatch-assignee"><span>{assignment?.status === "offered" ? "Chamada enviada para" : "Responsável"}</span><b>{driverName}</b></div>}
        {approvedGroup && ["ready_for_dispatch", "searching_driver"].includes(delivery.status) && <div className="dispatch-group-link"><small>DESPACHO AGRUPADO</small><b>Este pedido seguirá junto com o outro pedido aprovado.</b>{groupAssignment?.status === "offered" && <span>Chamada dupla aguardando resposta do motoboy.</span>}</div>}
        {delivery.status === "ready_for_dispatch" && !approvedGroup && <button className="button dark wide" disabled={busyId === delivery.id} onClick={() => call("start_delivery_dispatch", { requested_delivery_id: delivery.id }, delivery.id, "Chamada enviada ao próximo motoboy disponível.")}>Iniciar despacho</button>}
        {delivery.status === "searching_driver" && !assignment && !approvedGroup && <button className="button dark wide" disabled={busyId === delivery.id} onClick={() => call("start_delivery_dispatch", { requested_delivery_id: delivery.id }, delivery.id, "Próximo motoboy chamado.")}>Chamar próximo</button>}
        {delivery.status === "searching_driver" && assignment?.status === "offered" && <button className="button outline wide" disabled={busyId === delivery.id} onClick={() => call("expire_delivery_offer", { requested_assignment_id: assignment.id }, delivery.id, "Chamada encerrada; a fila avançou.")}>Encerrar chamada e avançar</button>}
        {["driver_assigned", "driver_to_pickup"].includes(delivery.status) && <div className="pickup-code-panel"><button className="button dark wide" disabled={busyId === delivery.id} onClick={() => void issuePickupCode(delivery.id)}>{credential ? "Gerar novo código" : "Gerar código de retirada"}</button>{credential && <div aria-live="polite"><small>MOSTRE SOMENTE AO MOTOBOY</small><strong>{credential.code}</strong><span>Válido por 30 minutos e exibido apenas nesta sessão.</span></div>}</div>}
        {delivery.status === "arrived" && <div className="manual-completion"><label htmlFor={`reason-${delivery.id}`}>Exceção sem PIN</label><input id={`reason-${delivery.id}`} className="input" value={manualReasons[delivery.id] || ""} onChange={event => setManualReasons(current => ({ ...current, [delivery.id]: event.target.value }))} placeholder="Motivo obrigatório para auditoria" /><button className="button outline wide" disabled={busyId === delivery.id} onClick={() => void completeWithoutPin(delivery.id)}>Concluir sem PIN</button></div>}
        {delivery.status === "returning_to_store" && <button className="button dark wide" disabled={busyId === delivery.id} onClick={() => call("confirm_return_to_store", { requested_delivery_id: delivery.id }, delivery.id, "Retorno confirmado e custódia encerrada.")}>Confirmar retorno à loja</button>}
      </article>;
    })}</div> : <div className="empty"><b>Nenhuma entrega em operação.</b><span>Os pedidos aparecem aqui quando a cozinha marcar como prontos.</span></div>}

    <DeliveryPickupHistory establishmentId={establishmentId} />
    <DeliveryCompletionHistory establishmentId={establishmentId} />
    <button className="button outline" aria-expanded={showAuditHistory} aria-controls="complete-delivery-audit" onClick={() => setShowAuditHistory(value => !value)}>{showAuditHistory ? "Fechar histórico completo" : "Consultar histórico e auditoria"}</button>
    <div id="complete-delivery-audit">{showAuditHistory && <DeliveryAuditHistory establishmentId={establishmentId} />}</div>
    <div className="delivery-audit-grid">
      <article><header><small>HISTÓRICO DE EVENTOS</small><h3>Linha do tempo operacional</h3></header>{dashboard?.events.length ? <ol className="delivery-event-timeline">{dashboard.events.slice(0, 16).map(event => <li key={event.id}><i /><div><b>Pedido #{event.order_number} · {eventLabels[event.event_type] || event.event_type}</b><span>{event.driver_name || (event.actor_type === "system" ? "Sistema" : "Equipe")} · {new Date(event.occurred_at).toLocaleString("pt-BR")}</span></div></li>)}</ol> : <div className="empty compact"><b>Nenhum evento registrado.</b></div>}</article>
      <article><header><small>ATENÇÃO ADMINISTRATIVA</small><h3>Ocorrências abertas</h3></header>{dashboard?.incidents.length ? <div className="delivery-incident-list">{dashboard.incidents.map(incident => <div key={incident.id}><b>Pedido #{incident.order_number} · {incident.type}</b><p>{incident.description}</p><span>{incident.driver_name || "Equipe"} · {new Date(incident.created_at).toLocaleString("pt-BR")}</span></div>)}</div> : <div className="empty compact"><b>Nenhuma ocorrência aberta.</b><span>A operação está sem pendências registradas.</span></div>}</article>
    </div>
  </section>;
}
