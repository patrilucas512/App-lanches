"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Initial = {
  name: string; description: string; phone: string; whatsapp: string; address: string;
  city: string; state: string; accentColor: string; secondaryColor: string;
  estimatedMinutes: number; minimumOrderCents: number;
};

export function SettingsForm({ establishmentId, initial }: { establishmentId: string; initial: Initial }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const supabase = createClient();
    const [establishmentResult, settingsResult] = await Promise.all([
      supabase.from("establishments").update({
        name: String(form.get("name")), description: String(form.get("description") || "") || null,
        phone: String(form.get("phone") || "") || null, city: String(form.get("city") || "") || null,
        state: String(form.get("state") || "").toUpperCase() || null,
        accent_color: String(form.get("accentColor")), secondary_color: String(form.get("secondaryColor")),
      }).eq("id", establishmentId),
      supabase.from("establishment_settings").update({
        whatsapp: String(form.get("whatsapp") || "").replace(/\D/g, "") || null,
        address: { street: String(form.get("address") || ""), city: String(form.get("city") || ""), state: String(form.get("state") || "").toUpperCase() },
        estimated_minutes: Number(form.get("estimatedMinutes")),
        minimum_order_cents: Math.round(Number(String(form.get("minimumOrder")).replace(",", ".")) * 100) || 0,
      }).eq("establishment_id", establishmentId),
    ]);
    const error = establishmentResult.error || settingsResult.error;
    setMessage(error ? error.message : "Configurações salvas com sucesso.");
    setLoading(false);
  }
  return <form className="panel form settings-form" onSubmit={submit}>
    <div className="form-grid">
      <div className="field"><label>NOME</label><input name="name" required defaultValue={initial.name} /></div>
      <div className="field"><label>WHATSAPP DE PEDIDOS</label><input name="whatsapp" required type="tel" defaultValue={initial.whatsapp} placeholder="5511999999999" /><small>Use DDD e código do país. Ex.: 5511999999999.</small></div>
      <div className="field field-wide"><label>DESCRIÇÃO</label><textarea name="description" defaultValue={initial.description} /></div>
      <div className="field"><label>TELEFONE</label><input name="phone" type="tel" defaultValue={initial.phone} /></div>
      <div className="field"><label>ENDEREÇO</label><input name="address" defaultValue={initial.address} /></div>
      <div className="field"><label>CIDADE</label><input name="city" defaultValue={initial.city} /></div>
      <div className="field"><label>UF</label><input name="state" maxLength={2} defaultValue={initial.state} /></div>
      <div className="field"><label>TEMPO ESTIMADO (MIN)</label><input name="estimatedMinutes" type="number" min="5" max="360" defaultValue={initial.estimatedMinutes} /></div>
      <div className="field"><label>PEDIDO MÍNIMO (R$)</label><input name="minimumOrder" inputMode="decimal" defaultValue={(initial.minimumOrderCents / 100).toFixed(2)} /></div>
      <div className="field"><label>COR PRINCIPAL</label><input name="accentColor" type="color" defaultValue={initial.accentColor} /></div>
      <div className="field"><label>COR SECUNDÁRIA</label><input name="secondaryColor" type="color" defaultValue={initial.secondaryColor} /></div>
    </div>
    {message && <div className={message.includes("sucesso") ? "form-message form-success" : "form-message"}>{message}</div>}
    <button className="button dark" disabled={loading}>{loading ? "Salvando..." : "Salvar configurações"}</button>
  </form>;
}
