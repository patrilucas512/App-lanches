"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { subscribeToPush, supportsPushNotifications } from "@/lib/push-notifications";

type Availability = { driver_profile_id: string; status: string; available_since: string | null; pause_reason: string | null; active_delivery_count: number };
type Assignment = { id: string; status: string; offered_at: string; expires_at: string; accepted_at: string | null; delivery_id: string; group_suggestion_id: string | null; score_breakdown: Record<string, unknown>; deliveries?: { id: string; status: string; customer_delivery_fee_cents: number; orders?: { order_number: number; customer_name: string; total_cents: number } | null } | null };
type DeliveryDetail = { driver_kind: "fixed" | "partner"; order_number: number; recipient_phone: string; payment_method: string; total_cents: number; cash_received_cents: number | null; cash_change_cents: number | null; items: {name:string;quantity:number}[]; delivery_id: string; status: string; recipient_name: string; phone: string; postal_code: string; street: string; street_number: string; complement?: string | null; neighborhood: string; city: string; state: string; reference?: string | null };

const statusLabels: Record<string, string> = { offline: "Turno encerrado", available: "Disponível", offered: "Nova chamada", collecting: "Indo retirar", delivering: "Em entrega", paused: "Pausado", blocked: "Bloqueado" };
const incidentOptions = [
  ["customer_absent", "Cliente ausente"], ["wrong_address", "Endereço incorreto"], ["payment", "Problema no pagamento"],
  ["vehicle", "Problema no veículo"], ["accident", "Acidente"], ["return", "Preciso retornar"], ["other", "Outro"],
];

export function DriverDispatchConsole({ establishmentId, driverId, driverKind, driverName, establishmentName, initialAvailability, initialAssignments }: {
  establishmentId: string; driverId: string; driverKind: "fixed" | "partner"; driverName: string; establishmentName: string; initialAvailability: Availability; initialAssignments: Assignment[];
}) {
  const [availability, setAvailability] = useState(initialAvailability);
  const [assignments, setAssignments] = useState(initialAssignments);
  const [selectedDeliveryId, setSelectedDeliveryId] = useState("");
  const [detail, setDetail] = useState<DeliveryDetail | null>(null);
  const [routeDetails, setRouteDetails] = useState<DeliveryDetail[]>([]);
  const [pickupCode, setPickupCode] = useState("");
  const [deliveryPin, setDeliveryPin] = useState("");
  const [incidentType, setIncidentType] = useState("customer_absent");
  const [incidentDescription, setIncidentDescription] = useState("");
  const [showIncident, setShowIncident] = useState(false);
  const [locationEnabled, setLocationEnabled] = useState(false);
  const [locationSessionId, setLocationSessionId] = useState("");
  const [locationMessage, setLocationMessage] = useState("Localização desativada");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [pushStatus, setPushStatus] = useState<"unsupported" | "inactive" | "active">(() => supportsPushNotifications() ? "inactive" : "unsupported");
  const [isOnline, setIsOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(async () => {
    const supabase = createClient();
    if (driverKind === "fixed") await supabase.rpc("refresh_fixed_driver_shift");
    const [{ data: nextAvailability }, { data: nextAssignments }] = await Promise.all([
      supabase.from("driver_availability").select("driver_profile_id,status,available_since,pause_reason,active_delivery_count").eq("driver_profile_id", driverId).maybeSingle(),
      supabase.from("delivery_assignments").select("id,status,offered_at,expires_at,accepted_at,delivery_id,group_suggestion_id,score_breakdown,deliveries(id,status,customer_delivery_fee_cents,orders(order_number,customer_name,total_cents))").eq("driver_profile_id", driverId).in("status", ["offered", "accepted"]).order("offered_at", { ascending: false }),
    ]);
    if (nextAvailability) setAvailability(nextAvailability as Availability);
    if (nextAssignments) {
      const typed = nextAssignments as unknown as Assignment[];
      setAssignments(typed);
      const active = typed.find(item => item.status === "accepted" && (!selectedDeliveryId || item.delivery_id === selectedDeliveryId)) || typed.find(item => item.status === "accepted");
      const results=await Promise.all(typed.filter(item=>item.status==="accepted").map(async item=>{
        const {data}=await supabase.rpc("get_driver_delivery_detail",{requested_delivery_id:item.delivery_id});
        return data as DeliveryDetail | null;
      }));
      const details=results.filter((item):item is DeliveryDetail=>!!item);
      setRouteDetails(details);
      setDetail(details.find(item=>item.delivery_id===active?.delivery_id)||null);
    }
  }, [driverId, driverKind, selectedDeliveryId]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`driver-dispatch-${driverId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "driver_availability", filter: `driver_profile_id=eq.${driverId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "delivery_assignments", filter: `driver_profile_id=eq.${driverId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "deliveries", filter: `establishment_id=eq.${establishmentId}` }, refresh).subscribe();
    void refresh();
    const timer = window.setInterval(() => { setNow(Date.now()); void refresh(); }, 5000);
    return () => { window.clearInterval(timer); void supabase.removeChannel(channel); };
  }, [driverId, establishmentId, refresh]);

  useEffect(() => {
    const handleOffline = () => setIsOnline(false);
    const handleOnline = () => {
      setIsOnline(true);
      setMessage("Conexão restabelecida. Dados sincronizados com segurança.");
      void refresh();
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [refresh]);

  const enablePushNotifications = useCallback(async (askPermission = true) => {
    const subscription = await subscribeToPush(askPermission).catch(() => null);
    if (!subscription) { if (askPermission) setMessage("Permita as notificações do navegador para receber novas entregas."); return; }
    const { error } = await createClient().rpc("register_driver_push_subscription", {
      requested_driver_profile_id: driverId,
      requested_subscription: subscription,
    });
    if (error) { if (askPermission) setMessage(error.message); return; }
    setPushStatus("active");
    if (askPermission) setMessage("Alertas de novas entregas ativados neste aparelho.");
  }, [driverId]);

  useEffect(() => { if (typeof Notification !== "undefined" && Notification.permission === "granted") void enablePushNotifications(false); }, [enablePushNotifications]);

  const openOffer = driverKind === "partner" ? assignments.find(item => item.status === "offered") : undefined;
  const activeAssignments = assignments.filter(item => item.status === "accepted");
  const activeAssignment = activeAssignments.find(item => item.delivery_id === selectedDeliveryId) || activeAssignments[0];
  const groupedOffer = openOffer?.group_suggestion_id ? openOffer.score_breakdown : null;
  const deliveryStatus = activeAssignment?.deliveries?.status || "";
  const secondsLeft = openOffer ? Math.max(0, Math.ceil((new Date(openOffer.expires_at).getTime() - now) / 1000)) : 0;
  const money = useMemo(() => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }), []);
  const fixedShiftActive = driverKind === "fixed" && !["offline", "paused", "blocked"].includes(availability.status);
  const visibleStatus = fixedShiftActive ? "available" : availability.status;
  const visibleStatusLabel = fixedShiftActive ? "ATIVO" : (statusLabels[availability.status] || availability.status);

  useEffect(() => {
    if (!activeAssignments.length) {
      if (selectedDeliveryId) setSelectedDeliveryId("");
      return;
    }
    if (!activeAssignments.some(item => item.delivery_id === selectedDeliveryId)) {
      setSelectedDeliveryId(activeAssignments[0].delivery_id);
    }
  }, [activeAssignments, selectedDeliveryId]);

  useEffect(() => {
    const allowed = ["driver_to_pickup", "picked_up", "on_route", "arrived", "returning_to_store"].includes(deliveryStatus);
    if (!locationEnabled || !allowed || !locationSessionId) return;
    if (!("geolocation" in navigator)) { setLocationMessage("Este aparelho não oferece localização."); return; }
    let lastSentAt = 0;
    const watchId = navigator.geolocation.watchPosition(async position => {
      if (Date.now() - lastSentAt < 8000) return;
      lastSentAt = Date.now();
      const { data, error } = await createClient().rpc("update_driver_location", {
        requested_latitude: position.coords.latitude,
        requested_longitude: position.coords.longitude,
        requested_accuracy_meters: position.coords.accuracy,
        requested_heading_degrees: position.coords.heading,
        requested_speed_mps: position.coords.speed,
        requested_captured_at: new Date(position.timestamp).toISOString(),
        requested_session_id: locationSessionId,
      });
      if (error) setLocationMessage(error.message);
      else if (data?.accepted === false) setLocationMessage("Aguardando o próximo envio seguro...");
      else setLocationMessage(`Localização enviada às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`);
    }, error => setLocationMessage(error.code === 1 ? "Permissão de localização negada no aparelho." : "Não foi possível obter sua localização."), {
      enableHighAccuracy: true, maximumAge: 5000, timeout: 15000,
    });
    return () => navigator.geolocation.clearWatch(watchId);
  }, [deliveryStatus, locationEnabled, locationSessionId]);

  function toggleLocation() {
    if (locationEnabled) { setLocationEnabled(false); setLocationMessage("Localização desativada"); return; }
    setLocationSessionId(crypto.randomUUID());
    setLocationEnabled(true);
    setLocationMessage("Solicitando permissão do aparelho...");
  }

  async function rpc(name: string, params: Record<string, unknown>, success = "Etapa confirmada.") {
    if (!isOnline || !navigator.onLine) {
      setIsOnline(false);
      setMessage("Sem conexão. Aguarde a internet voltar antes de confirmar esta ação.");
      return;
    }
    setBusy(true); setMessage("");
    const { data, error } = await createClient().rpc(name, params);
    if (error) setMessage(error.message);
    else if (data && typeof data === "object" && "verified" in data && data.verified === false) setMessage(String(data.reason || "Código inválido."));
    else { setMessage(success); setPickupCode(""); setDeliveryPin(""); }
    await refresh(); setBusy(false);
  }

  async function reportIncident() {
    if (incidentDescription.trim().length < 3 || !activeAssignment) return setMessage("Descreva o ocorrido com pelo menos 3 caracteres.");
    await rpc("report_delivery_incident", { requested_delivery_id: activeAssignment.delivery_id, requested_incident_type: incidentType, requested_description: incidentDescription.trim() }, "Ocorrência registrada. Retorne o pedido ao estabelecimento.");
    setShowIncident(false); setIncidentDescription("");
  }

  async function logout() { await createClient().auth.signOut(); window.location.assign("/motoboy/login"); }
  const formatAddress=(value:DeliveryDetail)=>[`${value.street}, ${value.street_number}`,value.complement,value.neighborhood,[value.city,value.state].filter(Boolean).join("/"),value.postal_code].filter(Boolean).join(" · ");
  const address=detail?formatAddress(detail):"";


  return <main className="pos-shell driver-console">
    <header className="pos-top"><div><small>MOTOBOY · MASTERAPP</small><h1>Olá, {driverName}.</h1><p>{establishmentName} · acesso individual</p></div><div className="pos-top-actions"><span className={`driver-status status-${visibleStatus}`}>{visibleStatusLabel}</span>{pushStatus !== "unsupported" && <button className={`button outline ${pushStatus === "active" ? "notification-active" : ""}`} onClick={() => void enablePushNotifications(true)}>{pushStatus === "active" ? "Alertas ativos" : "Ativar alertas"}</button>}<button className="button outline" onClick={logout}>Sair</button></div></header>
    {!isOnline && <div className="driver-offline-banner" role="alert"><b>Sem conexão.</b><span>As ações ficam bloqueadas até o celular voltar à internet. Nada será confirmado sem resposta do servidor.</span></div>}
    {message && <div className="form-message pos-message" role="status">{message}</div>}
    <section className="panel driver-shift-panel"><div><span className="kicker">SEU TURNO</span><h2>{fixedShiftActive ? "Turno ativo e recebendo comandas." : "Controle sua disponibilidade."}</h2><p>{driverKind === "fixed" ? "Toque uma vez para ficar ativo. Ao finalizar uma entrega, você volta automaticamente para a fila e recebe a próxima comanda da cozinha nesta tela." : "Quando você fica disponível, o MasterApp distribui as chamadas pela ordem justa da fila."}</p></div><div className="driver-shift-actions"><button className="button dark" disabled={busy || fixedShiftActive || availability.status === "available" || availability.active_delivery_count > 0} onClick={() => rpc("set_driver_availability", { requested_status: "available", requested_pause_reason: null }, driverKind === "fixed" ? "Turno ativado. As comandas aparecerão automaticamente." : "Você está disponível para novas entregas.")}>{fixedShiftActive ? "Ativo · recebendo comandas" : "Ficar disponível"}</button><button className="button outline" disabled={busy || availability.active_delivery_count > 0} onClick={() => rpc("set_driver_availability", { requested_status: "paused", requested_pause_reason: "Pausa do turno" })}>Pausar</button><button className="button outline" disabled={busy || availability.active_delivery_count > 0} onClick={() => rpc("set_driver_availability", { requested_status: "offline", requested_pause_reason: null })}>Encerrar turno</button></div></section>

    {openOffer && <section className="panel driver-offer-card" aria-live="assertive"><div className="driver-offer-timer"><span>{groupedOffer ? "NOVA ROTA AGRUPADA" : "NOVA ENTREGA"}</span><strong>{secondsLeft}s</strong></div><h2>Pedido #{openOffer.deliveries?.orders?.order_number}{groupedOffer ? ` + #${String(groupedOffer.paired_order_number || "")}` : ""}</h2><p>Retirada em <b>{establishmentName}</b>. {groupedOffer ? "Os dois pedidos serão colocados sob sua responsabilidade em um único aceite." : "Ao aceitar, a nota e o endereço ficam disponíveis para planejar sua rota."}</p><dl><div><dt>Cliente</dt><dd>{openOffer.deliveries?.orders?.customer_name}</dd></div><div><dt>Pedido</dt><dd>{money.format((openOffer.deliveries?.orders?.total_cents || 0) / 100)}</dd></div><div><dt>Taxa</dt><dd>{money.format((openOffer.deliveries?.customer_delivery_fee_cents || 0) / 100)}</dd></div>{groupedOffer && <><div><dt>Segundo cliente</dt><dd>{String(groupedOffer.paired_customer_name || "")}</dd></div><div><dt>Segundo pedido</dt><dd>{money.format(Number(groupedOffer.paired_total_cents || 0) / 100)}</dd></div><div><dt>Segunda taxa</dt><dd>{money.format(Number(groupedOffer.paired_delivery_fee_cents || 0) / 100)}</dd></div></>}</dl><div className="driver-offer-actions"><button className="button dark" disabled={busy || secondsLeft === 0} onClick={() => rpc("accept_delivery_assignment", { requested_assignment_id: openOffer.id }, groupedOffer ? "As duas entregas foram aceitas." : "Entrega aceita.")}>{groupedOffer ? "Aceitar as 2 entregas" : "Aceitar entrega"}</button><button className="button outline" disabled={busy} onClick={() => rpc("reject_delivery_assignment", { requested_assignment_id: openOffer.id, requested_reason: "Indisponível para esta chamada" }, "Chamada recusada.")}>Recusar</button></div></section>}

    {routeDetails.length>1 && <section className="panel"><h2>Endereços da minha rota</h2><p>Selecione uma parada para conferir a nota e iniciar ou finalizar essa entrega.</p>{routeDetails.map(item=><article key={item.delivery_id} className="driver-address-card"><h3>Pedido #{item.order_number} · {item.recipient_name}</h3><p>{formatAddress(item)}</p><button className="button outline" onClick={()=>setSelectedDeliveryId(item.delivery_id)}>Selecionar parada</button></article>)}<a className="button outline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(formatAddress(routeDetails[routeDetails.length-1]))}&waypoints=${encodeURIComponent(routeDetails.slice(0,-1).map(formatAddress).join("|"))}&travelmode=driving`}>Abrir rota com as paradas</a></section>}
    {activeAssignment && <section className="panel driver-active-card"><span className="kicker">ENTREGA EM SUA RESPONSABILIDADE</span>{activeAssignments.length > 1 && <div className="driver-group-tabs" role="tablist" aria-label="Pedidos da rota agrupada">{activeAssignments.map((item, index) => <button key={item.id} type="button" role="tab" aria-selected={item.delivery_id === activeAssignment.delivery_id} className={item.delivery_id === activeAssignment.delivery_id ? "active" : ""} onClick={() => setSelectedDeliveryId(item.delivery_id)}>Parada {index + 1} · Pedido #{item.deliveries?.orders?.order_number}</button>)}</div>}<h2>Pedido #{activeAssignment.deliveries?.orders?.order_number}</h2><div className="status-pill">Responsável: {driverName}{activeAssignments.length > 1 ? ` · ${activeAssignments.length} entregas nesta rota` : ""}</div>
      {["driver_to_pickup", "picked_up", "on_route", "arrived", "returning_to_store"].includes(deliveryStatus) && <div className={`driver-location-control ${locationEnabled ? "active" : ""}`}><div><small>LOCALIZAÇÃO DA ENTREGA</small><b>{locationEnabled ? "Compartilhamento ativo" : "Compartilhamento pausado"}</b><span>{locationMessage}</span></div><button className={`button ${locationEnabled ? "outline" : "dark"}`} onClick={toggleLocation}>{locationEnabled ? "Pausar localização" : "Ativar localização"}</button></div>}
      {deliveryStatus === "driver_assigned" && driverKind === "partner" && <><p>A nota e o endereço já estão disponíveis. Ao chegar à loja, confirme para liberar o código de retirada deste pedido.</p><button className="button dark wide" disabled={busy} onClick={() => rpc("mark_driver_to_pickup", { requested_delivery_id: activeAssignment.delivery_id }, "Chegada à loja registrada. Confira o número do pedido e informe o código de retirada.")}>Cheguei na loja · retirar pedido #{activeAssignment.deliveries?.orders?.order_number}</button></>}
      {deliveryStatus === "driver_to_pickup" && detail?.driver_kind !== "fixed" && <div className="custody-step"><h3>Retirada segura</h3><p>Peça ao estabelecimento o código de 6 números exibido no painel.</p><input className="input custody-code" inputMode="numeric" maxLength={6} value={pickupCode} onChange={event => setPickupCode(event.target.value.replace(/\D/g, ""))} placeholder="000000" aria-label="Código de retirada" /><button className="button dark wide" disabled={busy || pickupCode.length !== 6} onClick={() => rpc("verify_pickup_code", { requested_delivery_id: activeAssignment.delivery_id, requested_code: pickupCode }, "Retirada confirmada. Endereço liberado.")}>Confirmar retirada</button></div>}
      {detail && detail.delivery_id===activeAssignment.delivery_id && <div className="driver-address-card"><small>NOTA DA ENTREGA</small><h3>{detail.recipient_name}</h3><p>{address}</p><ul>{detail.items?.map((item,index)=><li key={index}>{item.quantity}× {item.name}</li>)}</ul><p>Pagamento: {({cash:"Dinheiro",credit_card:"Cartão na entrega",debit_card:"Cartão na entrega",mercado_pago_online:"Online",pix:"Pix"} as Record<string,string>)[detail.payment_method]||detail.payment_method} · Total {money.format(detail.total_cents/100)}</p>{detail.payment_method==="cash" && <p>Cliente paga: {money.format((detail.cash_received_cents||detail.total_cents)/100)} · Troco: {money.format((detail.cash_change_cents||0)/100)}</p>}<a className="button outline wide" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`} target="_blank" rel="noreferrer">Abrir rota</a><a href={`tel:${detail.recipient_phone}`}>{detail.recipient_phone}</a>{detail.reference && <span>Referência: {detail.reference}</span>}</div>}
      {["driver_assigned","driver_to_pickup"].includes(deliveryStatus) && detail?.delivery_id===activeAssignment.delivery_id && detail?.driver_kind === "fixed" && <button className="button dark wide" disabled={busy} onClick={()=>rpc("verify_pickup_code",{requested_delivery_id:activeAssignment.delivery_id,requested_code:""},"Retirada registrada. Você já pode iniciar a rota.")}>Retirei o pedido · sem código · #{activeAssignment.deliveries?.orders?.order_number}</button>}
      {deliveryStatus === "picked_up" && <button className="button dark wide" disabled={busy} onClick={() => rpc("start_delivery_route", { requested_delivery_id: activeAssignment.delivery_id }, "Entrega em rota.")}>Iniciar rota de entrega</button>}
      {deliveryStatus === "on_route" && <button className="button dark wide" disabled={busy} onClick={() => rpc("mark_driver_arrived", { requested_delivery_id: activeAssignment.delivery_id }, "Chegada registrada.")}>Cheguei ao endereço</button>}
      {deliveryStatus === "arrived" && <div className="custody-step"><h3>Confirmação da entrega</h3><p>Peça ao cliente o PIN de 4 números mostrado no acompanhamento do pedido.</p><input className="input custody-code" inputMode="numeric" maxLength={4} value={deliveryPin} onChange={event => setDeliveryPin(event.target.value.replace(/\D/g, ""))} placeholder="0000" aria-label="PIN de entrega" /><button className="button dark wide" disabled={busy || deliveryPin.length !== 4} onClick={() => rpc("verify_delivery_pin", { requested_delivery_id: activeAssignment.delivery_id, requested_pin: deliveryPin }, "Entrega concluída com segurança.")}>Confirmar entrega</button></div>}
      {deliveryStatus === "returning_to_store" && <div className="custody-return"><b>Retorno ao estabelecimento</b><p>Leve o pedido de volta. Um responsável confirmará o recebimento no painel.</p></div>}
      {["picked_up", "on_route", "arrived"].includes(deliveryStatus) && <><button className="button outline wide" onClick={() => setShowIncident(value => !value)}>Informar ocorrência</button>{showIncident && <div className="incident-form"><select className="input" value={incidentType} onChange={event => setIncidentType(event.target.value)}>{incidentOptions.map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select><textarea className="input" value={incidentDescription} onChange={event => setIncidentDescription(event.target.value)} placeholder="Descreva o ocorrido" /><button className="button dark" disabled={busy} onClick={() => void reportIncident()}>Registrar e retornar</button></div>}</>}
    </section>}
    {!openOffer && !activeAssignment && <section className="panel driver-waiting-card"><span aria-hidden="true">⌁</span><h2>{availability.status === "available" ? "Aguardando a próxima chamada." : "Fique disponível para receber entregas."}</h2><p>As novas chamadas aparecem aqui automaticamente, sem atualizar a página.</p></section>}
  </main>;
}
