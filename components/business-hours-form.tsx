"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { BusinessHour } from "@/lib/business-hours";

const days = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

export function BusinessHoursForm({ establishmentId, initial }: { establishmentId: string; initial: BusinessHour[] }) {
  const [rows, setRows] = useState<BusinessHour[]>(days.map((_, weekday) => initial.find(item => item.weekday === weekday) || { weekday, opens_at: "18:00", closes_at: "23:00", closed: false }));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  function update(weekday: number, changes: Partial<BusinessHour>) {
    setRows(current => current.map(row => row.weekday === weekday ? { ...row, ...changes } : row));
  }

  async function save() {
    setSaving(true); setMessage("");
    const supabase = createClient();
    const payload = rows.map(row => ({
      establishment_id: establishmentId,
      weekday: row.weekday,
      opens_at: row.closed ? null : row.opens_at,
      closes_at: row.closed ? null : row.closes_at,
      closed: row.closed,
    }));
    const { error } = await supabase.from("business_hours").upsert(payload, { onConflict: "establishment_id,weekday" });
    setSaving(false);
    setMessage(error ? error.message : "Horários salvos. A cozinha separará automaticamente os pedidos de cada dia.");
  }

  return <section className="panel business-hours-panel" id="horarios">
    <header className="team-group-head"><div><small>FUNCIONAMENTO</small><h2>Horários do estabelecimento</h2><p>Ao encerrar o expediente, os pedidos entregues saem da cozinha e permanecem salvos em Pedidos semanais.</p></div></header>
    <div className="business-hours-list">{rows.map(row => <div className={`business-hour-row ${row.closed ? "is-closed" : ""}`} key={row.weekday}>
      <b>{days[row.weekday]}</b>
      <label><span>Abre</span><input type="time" value={(row.opens_at || "18:00").slice(0, 5)} disabled={row.closed} onChange={event => update(row.weekday, { opens_at: event.target.value })} /></label>
      <label><span>Fecha</span><input type="time" value={(row.closes_at || "23:00").slice(0, 5)} disabled={row.closed} onChange={event => update(row.weekday, { closes_at: event.target.value })} /></label>
      <label className="business-hour-closed"><input type="checkbox" checked={row.closed} onChange={event => update(row.weekday, { closed: event.target.checked })} /><span>Fechado</span></label>
    </div>)}</div>
    {message && <div className={message.startsWith("Horários") ? "form-message form-success" : "form-message"}>{message}</div>}
    <button type="button" className="button dark" disabled={saving} onClick={() => void save()}>{saving ? "Salvando..." : "Salvar horários"}</button>
  </section>;
}
