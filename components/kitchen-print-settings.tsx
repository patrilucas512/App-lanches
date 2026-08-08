"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function KitchenPrintSettings({ establishmentId, initialEnabled }: { establishmentId: string; initialEnabled: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [message, setMessage] = useState("");
  async function save(next: boolean) {
    setEnabled(next); setMessage("Salvando...");
    const { error } = await supabase.rpc("set_kitchen_auto_print", { requested_establishment_id: establishmentId, requested_enabled: next });
    setMessage(error?.message || (next ? "Impressão automática ativada." : "Impressão automática desativada."));
  }
  return <section className="panel kitchen-print-setting"><div><small>COZINHA</small><h2>Impressão da notinha</h2><p>Ao entrar um novo pedido, a tela da cozinha abre a impressão com nome completo, mesa, itens, retiradas, adicionais e observações.</p><small>O navegador pode pedir confirmação da impressora por segurança.</small></div><label className="setting-toggle"><input type="checkbox" checked={enabled} onChange={event => void save(event.target.checked)} /><span>{enabled ? "Ativada" : "Desativada"}</span></label>{message && <div className="form-message form-success">{message}</div>}</section>;
}
