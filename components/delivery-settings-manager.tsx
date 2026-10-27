"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type DeliverySettings = {
  service_city?: string | null;
  service_state?: string | null;
  id?: string;
  establishment_id: string;
  fee_model: "fixed" | "neighborhood";
  fixed_fee_cents: number;
  free_delivery_above_cents: number | null;
  alert_kitchen_delay_minutes: number;
  alert_waiting_driver_minutes: number;
  alert_driver_stale_minutes: number;
  alert_route_delay_minutes: number;
  alert_driver_stopped_minutes: number;
};

type DeliveryZone = {
  id: string;
  name: string;
  fee_cents: number;
  minimum_order_cents: number;
  free_delivery_above_cents: number | null;
  estimated_minutes: number | null;
  distance_km: number | null;
  active: boolean;
};

const money = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

const toCents = (value: FormDataEntryValue | null) => {
  const normalized = String(value || "0").replace(/\./g, "").replace(",", ".");
  return Math.max(0, Math.round((Number(normalized) || 0) * 100));
};

export function DeliverySettingsManager({
  establishmentId,
  initialSettings,
  initialZones,
}: {
  establishmentId: string;
  initialSettings: DeliverySettings;
  initialZones: DeliveryZone[];
}) {
  const supabase = createClient();
  const [settings, setSettings] = useState(initialSettings);
  const [zones, setZones] = useState(initialZones);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const freeValue = String(form.get("free_above") || "").trim();
    const payload: DeliverySettings = {
      service_city: String(form.get("service_city") || "").trim() || null,
      service_state: String(form.get("service_state") || "").trim().toUpperCase() || null,
      establishment_id: establishmentId,
      fee_model: String(form.get("fee_model")) as DeliverySettings["fee_model"],
      fixed_fee_cents: toCents(form.get("fixed_fee")),
      free_delivery_above_cents: freeValue ? toCents(freeValue) : null,
      alert_kitchen_delay_minutes: Math.max(3, Math.min(180, Number(form.get("alert_kitchen_delay")) || 10)),
      alert_waiting_driver_minutes: Math.max(3, Math.min(180, Number(form.get("alert_waiting_driver")) || 10)),
      alert_driver_stale_minutes: Math.max(3, Math.min(180, Number(form.get("alert_driver_stale")) || 8)),
      alert_route_delay_minutes: Math.max(3, Math.min(180, Number(form.get("alert_route_delay")) || 5)),
      alert_driver_stopped_minutes: Math.max(3, Math.min(60, Number(form.get("alert_driver_stopped")) || 8)),
    };
    const { data, error } = await supabase
      .from("delivery_settings")
      .upsert(payload, { onConflict: "establishment_id" })
      .select("service_city,service_state,id,establishment_id,fee_model,fixed_fee_cents,free_delivery_above_cents,alert_kitchen_delay_minutes,alert_waiting_driver_minutes,alert_driver_stale_minutes,alert_route_delay_minutes,alert_driver_stopped_minutes")
      .single();
    if (!error && data) setSettings(data as DeliverySettings);
    setMessage(error ? error.message : "Configuração de entrega salva.");
    setBusy(false);
  }

  async function addZone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const freeValue = String(form.get("zone_free_above") || "").trim();
    const { data, error } = await supabase
      .from("delivery_zones")
      .insert({
        establishment_id: establishmentId,
        name: String(form.get("zone_name") || "").trim(),
        fee_cents: toCents(form.get("zone_fee")),
        minimum_order_cents: toCents(form.get("zone_minimum")),
        free_delivery_above_cents: freeValue ? toCents(freeValue) : null,
        estimated_minutes: Math.max(5, Math.min(360, Number(form.get("zone_minutes")) || 45)),
        distance_km: Math.max(0.1, Math.min(500, Number(String(form.get("zone_distance") || "").replace(",", ".")) || 0.1)),
        active: true,
      })
      .select("id,name,fee_cents,minimum_order_cents,free_delivery_above_cents,estimated_minutes,distance_km,active")
      .single();
    if (!error && data) {
      setZones((current) => [...current, data as DeliveryZone].sort((a, b) => a.name.localeCompare(b.name)));
      formElement.reset();
    }
    setMessage(error ? error.message : "Bairro adicionado à área de entrega.");
    setBusy(false);
  }

  async function toggleZone(zone: DeliveryZone) {
    setBusy(true);
    const { data, error } = await supabase
      .from("delivery_zones")
      .update({ active: !zone.active })
      .eq("id", zone.id)
      .eq("establishment_id", establishmentId)
      .select("id,name,fee_cents,minimum_order_cents,free_delivery_above_cents,estimated_minutes,distance_km,active")
      .single();
    if (!error && data) setZones((current) => current.map((item) => item.id === zone.id ? data as DeliveryZone : item));
    setMessage(error ? error.message : `Bairro ${zone.active ? "pausado" : "ativado"}.`);
    setBusy(false);
  }

  async function deleteZone(zone: DeliveryZone) {
    if (!window.confirm(`Excluir a área de entrega “${zone.name}”?`)) return;
    setBusy(true);
    const { error } = await supabase
      .from("delivery_zones")
      .delete()
      .eq("id", zone.id)
      .eq("establishment_id", establishmentId);
    if (!error) setZones((current) => current.filter((item) => item.id !== zone.id));
    setMessage(error ? error.message : "Área de entrega excluída.");
    setBusy(false);
  }

  return <section className="panel delivery-settings-panel" id="delivery">
    <header className="delivery-settings-head">
      <div><small>CONFIGURAÇÕES · DELIVERY</small><h2>Entrega simples, segura e previsível.</h2><p>Defina a taxa e a distância de cada bairro. O sistema combina esses dados com cozinha, motoboys e histórico para calcular a previsão.</p></div>
      <span className="status-pill active">Configurável</span>
    </header>

    <form className="delivery-rule-form" onSubmit={saveSettings}>
      <div className="field"><label>CIDADE DAS ENTREGAS</label><input name="service_city" minLength={2} maxLength={80} defaultValue={settings.service_city || ""} placeholder="Cidade atendida" /><small>Preenchida nos novos pedidos, sem perguntar novamente ao cliente.</small></div>
      <div className="field"><label>ESTADO (UF)</label><input name="service_state" minLength={2} maxLength={2} pattern="[A-Za-z]{2}" defaultValue={settings.service_state || ""} placeholder="Ex.: RJ" /></div>
      <div className="field"><label>MODELO DA TAXA</label><select name="fee_model" value={settings.fee_model} onChange={(event) => setSettings((current) => ({ ...current, fee_model: event.target.value as DeliverySettings["fee_model"] }))}><option value="fixed">Taxa fixa para toda entrega</option><option value="neighborhood">Taxa diferente por bairro</option></select></div>
      <div className="field"><label>TAXA FIXA (R$)</label><input name="fixed_fee" inputMode="decimal" defaultValue={(settings.fixed_fee_cents / 100).toFixed(2).replace(".", ",")} disabled={settings.fee_model !== "fixed"} /></div>
      <div className="field"><label>GRÁTIS A PARTIR DE (R$)</label><input name="free_above" inputMode="decimal" defaultValue={settings.free_delivery_above_cents === null ? "" : (settings.free_delivery_above_cents / 100).toFixed(2).replace(".", ",")} placeholder="Opcional" /></div>
      <div className="delivery-alert-settings">
        <div><small>ALERTAS DE ATRASO</small><h3>Limites da operação</h3><p>O sistema avisa o administrador e resolve o alerta automaticamente quando o fluxo normaliza. Estes avisos são operacionais e não são registros disciplinares.</p></div>
        <div className="delivery-alert-settings-grid">
          <div className="field"><label htmlFor="alert-driver-stopped">PARADA LONGE DO DESTINO (MIN)</label><input id="alert-driver-stopped" name="alert_driver_stopped" type="number" required min={3} max={60} defaultValue={settings.alert_driver_stopped_minutes ?? 8} /><small>Exige destino confirmado e GPS recente com boa precisão. Gera “Possível atraso” para análise.</small></div>
          <div className="field"><label>COZINHA (MIN)</label><input name="alert_kitchen_delay" type="number" min={3} max={180} defaultValue={settings.alert_kitchen_delay_minutes ?? 10} /></div>
          <div className="field"><label>AGUARDANDO MOTOBOY (MIN)</label><input name="alert_waiting_driver" type="number" min={3} max={180} defaultValue={settings.alert_waiting_driver_minutes ?? 10} /></div>
          <div className="field"><label>GPS SEM ATUALIZAR (MIN)</label><input name="alert_driver_stale" type="number" min={3} max={180} defaultValue={settings.alert_driver_stale_minutes ?? 8} /></div>
          <div className="field"><label>ROTA ALÉM DA PREVISÃO (MIN)</label><input name="alert_route_delay" type="number" min={3} max={180} defaultValue={settings.alert_route_delay_minutes ?? 5} /></div>
        </div>
      </div>
      <button className="button dark" disabled={busy}>{busy ? "Salvando..." : "Salvar entrega e alertas"}</button>
    </form>

    <div className="delivery-zone-section">
      <div><small>ÁREA DE ENTREGA</small><h3>Bairros atendidos</h3><p>Usados quando o modelo escolhido for taxa por bairro.</p></div>
      <form className="delivery-zone-form" onSubmit={addZone}>
        <div className="field"><label>BAIRRO</label><input name="zone_name" required minLength={2} maxLength={80} placeholder="Ex.: Centro" /></div>
        <div className="field"><label>TAXA (R$)</label><input name="zone_fee" required inputMode="decimal" placeholder="5,00" /></div>
        <div className="field"><label>PEDIDO MÍNIMO (R$)</label><input name="zone_minimum" inputMode="decimal" placeholder="0,00" /></div>
        <div className="field"><label>GRÁTIS A PARTIR DE (R$)</label><input name="zone_free_above" inputMode="decimal" placeholder="Opcional" /></div>
        <div className="field"><label>DISTÂNCIA APROXIMADA (KM)</label><input name="zone_distance" required inputMode="decimal" placeholder="Ex.: 4,5" /></div>
        <div className="field"><label>PREVISÃO (MIN)</label><input name="zone_minutes" type="number" min={5} max={360} defaultValue={45} /></div>
        <button className="button outline" disabled={busy}>Adicionar bairro</button>
      </form>
      <div className="delivery-zone-list">
        {zones.length ? zones.map((zone) => <article key={zone.id} className={zone.active ? "" : "inactive"}>
          <div><small>{zone.active ? "ATIVO" : "PAUSADO"}</small><b>{zone.name}</b><span>{money(zone.fee_cents)} · mínimo {money(zone.minimum_order_cents)} · {zone.distance_km ? `${Number(zone.distance_km).toLocaleString("pt-BR")} km · ` : ""}{zone.estimated_minutes || 45} min base</span></div>
          <div className="delivery-zone-actions"><button type="button" onClick={() => toggleZone(zone)} disabled={busy}>{zone.active ? "Pausar" : "Ativar"}</button><button type="button" className="danger" onClick={() => deleteZone(zone)} disabled={busy}>Excluir</button></div>
        </article>) : <div className="empty">Nenhum bairro cadastrado.</div>}
      </div>
    </div>
    {message && <div className={message.includes("salv") || message.includes("adicionado") || message.includes("ativado") || message.includes("excluída") ? "form-message form-success" : "form-message"}>{message}</div>}
  </section>;
}
